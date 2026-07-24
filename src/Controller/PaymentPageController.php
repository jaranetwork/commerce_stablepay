<?php

namespace Drupal\commerce_stablepay\Controller;

use Drupal\commerce_order\Entity\OrderInterface;
use Drupal\commerce_price\Price;
use Drupal\Core\Access\AccessResult;
use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Url;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class PaymentPageController extends ControllerBase {

  public function access(OrderInterface $commerce_order) {
    $current_user = $this->currentUser();
    if ($commerce_order->getCustomerId() == $current_user->id() || $current_user->hasPermission('administer commerce_payment')) {
      return AccessResult::allowed();
    }
    return AccessResult::forbidden();
  }

  protected function loadGatewayPlugin(OrderInterface $order) {
    $gateway_id = $order->get('payment_gateway')->target_id;
    if (empty($gateway_id)) {
      return NULL;
    }
    $payment_gateway = $this->entityTypeManager()->getStorage('commerce_payment_gateway')->load($gateway_id);
    if (!$payment_gateway || $payment_gateway->getPluginId() !== 'stablepay_offsite') {
      return NULL;
    }
    return $payment_gateway->getPlugin();
  }

  public function build(OrderInterface $commerce_order) {
    $state = $commerce_order->get('state')->first()->getValue()['value'] ?? '';

    $plugin = $this->loadGatewayPlugin($commerce_order);
    if (!$plugin) {
      $this->messenger()->addError($this->t('This order is not configured for crypto payment.'));
      return $this->redirect('commerce_checkout.form', [
        'commerce_order' => $commerce_order->id(),
      ]);
    }

    $valid_states = ['draft', 'checkout'];
    if (!in_array($state, $valid_states)) {
      return $this->redirect('commerce_checkout.form', [
        'commerce_order' => $commerce_order->id(),
        'step' => 'complete',
      ]);
    }

    $payment_storage = $this->entityTypeManager()->getStorage('commerce_payment');
    $pending = $payment_storage->loadByProperties([
      'order_id' => $commerce_order->id(),
      'state' => 'pending',
    ]);

    if (empty($pending)) {
      $payment_gateway_id = $commerce_order->get('payment_gateway')->target_id;
      $payment = $payment_storage->create([
        'state' => 'pending',
        'amount' => $commerce_order->getBalance(),
        'payment_gateway' => $payment_gateway_id,
        'order_id' => $commerce_order->id(),
      ]);
      $payment->save();
    }

    $amount = $commerce_order->getTotalPrice();
    if ($amount && $amount->getCurrencyCode() !== 'USD') {
      $currency = $amount->getCurrencyCode();
      $rate = static::fetchFiatToUsdRate($currency);
      if ($rate > 0) {
        $usdt_amount = $amount->getNumber() / $rate;
        $amount = new Price(
          number_format($usdt_amount, 2, '.', ''),
          'USD'
        );
      }
      else {
        \Drupal::logger('commerce_stablepay')->warning('Rate zero or empty for @cur, skipping conversion', ['@cur' => $currency]);
      }
    }
    $address = NULL;
    $expires_at = NULL;
    $expiration = $plugin ? $plugin->getExpirationMinutes() : 30;
    $expires_at_dt = new \DateTime('+' . $expiration . ' minutes');
    $expires_at = $expires_at_dt->format('c');
    $addr_resp = static::callSidecar('derive', [
      'order_id' => (int) $commerce_order->id(),
    ]);
    if ($addr_resp && static::isValidAddress($addr_resp)) {
      $address = $addr_resp;
    } else {
      \Drupal::logger('commerce_stablepay')->warning('Could not derive address for order @id', ['@id' => $commerce_order->id()]);
    }

    $stablepay_data = $commerce_order->getData('stablepay');
    $onchain_balance = NULL;
    if (!empty($stablepay_data['rpc_url'])) {
      try {
        $client = \Drupal::httpClient();
        $sidecar_url = getenv('STABLEPAY_SIDECAR_URL') ?: 'http://stablepay-listener:3001';
        $balance_url = $sidecar_url . '/balance/' . $commerce_order->id()
          . '?rpc_url=' . urlencode($stablepay_data['rpc_url'])
          . '&token_address=' . urlencode($stablepay_data['token_address'])
          . '&token_symbol=' . urlencode($stablepay_data['token_symbol'] ?: 'USDT')
          . '&expected_amount=' . urlencode($stablepay_data['expected_amount'] ?: '0');
        $response = $client->get($balance_url, ['timeout' => 3]);
          $body = json_decode($response->getBody(), TRUE);
          if ($body && !empty($body['found'])) {
            $onchain_balance = [
              'balance' => $body['balance'],
              'expected' => $body['expected'],
              'token_symbol' => $body['token_symbol'],
            ];
          }
        } catch (\Exception $e) {
          \Drupal::logger('commerce_stablepay')->warning('Balance GET failed: ' . $e->getMessage());
        }
      }

    $status_url = Url::fromRoute('commerce_stablepay.status', [
      'commerce_order' => $commerce_order->id(),
    ])->toString();

    $networks = [
      [
        'name' => 'StableChain',
        'network' => 'stablechain',
        'tokenSymbol' => 'USDC',
        'tokenAddress' => $plugin->getStablechainUsdt(),
        'rpcUrl' => $plugin->getStablechainRpc(),
        'chainId' => 988,
        'decimals' => 6,
        'requiredConfirmations' => $plugin->getConfirmationBlocks(),
        'expirationMinutes' => $plugin->getExpirationMinutes(),
      ],
      [
        'name' => 'Celo',
        'network' => 'celo',
        'tokenSymbol' => 'USDC',
        'tokenAddress' => $plugin->getCeloUsdc(),
        'rpcUrl' => $plugin->getCeloRpc(),
        'chainId' => 42220,
        'decimals' => 6,
        'requiredConfirmations' => min($plugin->getConfirmationBlocks(), 12),
        'expirationMinutes' => $plugin->getExpirationMinutes(),
      ],
      [
        'name' => 'Celo',
        'network' => 'celo',
        'tokenSymbol' => 'USDT',
        'tokenAddress' => $plugin->getCeloUsdt(),
        'rpcUrl' => $plugin->getCeloRpc(),
        'chainId' => 42220,
        'decimals' => 6,
        'requiredConfirmations' => min($plugin->getConfirmationBlocks(), 12),
        'expirationMinutes' => $plugin->getExpirationMinutes(),
      ],
    ];

    if ($plugin->getMode() === 'test' && $plugin->getTestRpcUrl()) {
      $networks[] = [
        'name' => 'Test (' . $plugin->getTestTokenSymbol() . ')',
        'network' => 'test',
        'tokenSymbol' => $plugin->getTestTokenSymbol(),
        'tokenAddress' => $plugin->getTestTokenAddress(),
        'rpcUrl' => $plugin->getTestRpcUrl(),
        'chainId' => 31337,
        'decimals' => 6,
        'requiredConfirmations' => 1,
        'expirationMinutes' => 60,
      ];
    }

    $networks = array_values(array_filter($networks, fn($n) => !empty($n['tokenAddress'])));

    return [
      '#theme' => 'stablepay_payment_page',
      '#order_id' => $commerce_order->id(),
      '#amount' => $amount ? $amount->getNumber() : '0.00',
      '#currency' => $amount ? $amount->getCurrencyCode() : 'USD',
      '#networks' => json_encode($networks),
      '#address' => $address,
      '#expires_at' => $expires_at,
      '#notify_url' => $plugin ? $plugin->getNotifyUrl() : '',
      '#status_url' => $status_url,
      '#onchain_balance' => json_encode($onchain_balance),
      '#return_url' => Url::fromRoute('commerce_checkout.form', [
        'commerce_order' => $commerce_order->id(),
        'step' => 'complete',
      ])->setAbsolute()->toString(),
      '#attached' => [
        'library' => ['commerce_stablepay/checkout'],
        'drupalSettings' => [
          'stablepay' => [
            'address' => $address,
            'expires_at' => $expires_at,
          ],
        ],
      ],
      '#cache' => [
        'max-age' => 0,
      ],
    ];
  }

  protected function checkAccess(OrderInterface $commerce_order) {
    $uid = $this->currentUser()->id();
    if ($commerce_order->getCustomerId() != $uid && !$this->currentUser()->hasPermission('administer commerce_payment')) {
      throw new NotFoundHttpException();
    }
  }

  public function status(OrderInterface $commerce_order) {
    $this->checkAccess($commerce_order);
    $payment_storage = $this->entityTypeManager()->getStorage('commerce_payment');
    $payments = $payment_storage->loadByProperties([
      'order_id' => $commerce_order->id(),
    ]);

    $payments_data = [];
    foreach ($payments as $payment) {
      $payments_data[] = [
        'state' => $payment->getState()->getId(),
        'remote_id' => $payment->getRemoteId(),
        'remote_state' => $payment->getRemoteState(),
        'amount' => $payment->getAmount()->getNumber(),
      ];
    }

    $onchain = NULL;
    try {
      $client = \Drupal::httpClient();
      $sidecar_url = getenv('STABLEPAY_SIDECAR_URL') ?: 'http://stablepay-listener:3001';
      $balance_url = $sidecar_url . '/balance/' . $commerce_order->id();
      $stablepay_data = $commerce_order->getData('stablepay');
      if (!empty($stablepay_data['rpc_url'])) {
        $balance_url .= '?rpc_url=' . urlencode($stablepay_data['rpc_url'])
          . '&token_address=' . urlencode($stablepay_data['token_address'])
          . '&token_symbol=' . urlencode($stablepay_data['token_symbol'] ?: 'USDT')
          . '&expected_amount=' . urlencode($stablepay_data['expected_amount'] ?: '0');
      }
      $response = $client->get($balance_url, ['timeout' => 3]);
      $body = json_decode($response->getBody(), TRUE);
      if ($body && !empty($body['found'])) {
        $onchain = [
          'balance' => $body['balance'],
          'expected' => $body['expected'],
          'token_symbol' => $body['token_symbol'],
        ];
      }
    } catch (\Exception $e) {
      \Drupal::logger('commerce_stablepay')->warning('Balance check failed: ' . $e->getMessage());
    }

    // Auto-confirm if balance meets or exceeds expected
    if ($onchain && !empty($onchain['balance']) && !empty($onchain['expected'])
        && (float) $onchain['balance'] >= (float) $onchain['expected']) {
      $completed = $payment_storage->loadByProperties([
        'order_id' => $commerce_order->id(),
        'state' => 'completed',
      ]);
      if (empty($completed) && !empty($stablepay_data['rpc_url']) && !empty($stablepay_data['token_address'])) {
        $tx_resp = static::callSidecarGet('get-tx/' . $commerce_order->id(), [
          'rpc_url' => $stablepay_data['rpc_url'],
          'token_address' => $stablepay_data['token_address'],
        ]);
        if ($tx_resp && !empty($tx_resp['tx_hash'])) {
          $payment_gateway_id = $commerce_order->get('payment_gateway')->target_id;
          $pending = $payment_storage->loadByProperties([
            'order_id' => $commerce_order->id(),
            'state' => 'pending',
          ]);
          if (!empty($pending)) {
            $payment = reset($pending);
            $payment->set('state', 'completed');
            $payment->setRemoteId($tx_resp['tx_hash']);
            $payment->setRemoteState('completed');
          } else {
            $total = $commerce_order->getTotalPrice();
            $payment = $payment_storage->create([
              'state' => 'completed',
              'amount' => $total ?: new Price('0', 'USD'),
              'payment_gateway' => $payment_gateway_id,
              'order_id' => $commerce_order->id(),
              'remote_id' => $tx_resp['tx_hash'],
              'remote_state' => 'completed',
            ]);
          }
          $payment->save();
          $state_item = $commerce_order->get('state')->first();
          if ($state_item->getValue()['value'] === 'draft') {
            if ($transitions = $state_item->getTransitions()) {
              $state_item->applyTransition(current($transitions));
              if ($commerce_order->isLocked()) {
                $commerce_order->unlock();
              }
              $commerce_order->save();
            }
          }
          \Drupal::logger('commerce_stablepay')->notice('status: auto-confirmed order ' . $commerce_order->id() . ' tx=' . $tx_resp['tx_hash']);
        }
      }
    }

    return new JsonResponse([
      'order_id' => $commerce_order->id(),
      'order_state' => $commerce_order->get('state')->first()->getValue()['value'],
      'payments' => $payments_data,
      'onchain_balance' => $onchain,
    ]);
  }

  public function deriveAddress(OrderInterface $commerce_order, Request $request) {
    $this->checkAccess($commerce_order);

    $plugin = $this->loadGatewayPlugin($commerce_order);
    $expiration = $plugin ? $plugin->getExpirationMinutes() : 30;
    $expiresAt = new \DateTime('+' . $expiration . ' minutes');

    $sidecar_data = [
      'order_id' => (int) $commerce_order->id(),
    ];

    $rpc_url = $request->query->get('rpc_url') ?? $request->request->get('rpc_url');
    $token_address = $request->query->get('token_address') ?? $request->request->get('token_address');
    $token_symbol = $request->query->get('token_symbol') ?? $request->request->get('token_symbol');
    $expected_amount = $request->query->get('amount') ?? $request->request->get('amount');

    if ($rpc_url && $token_address) {
      $sidecar_data['rpc_url'] = $rpc_url;
      $sidecar_data['token_address'] = $token_address;
      $sidecar_data['token_symbol'] = $token_symbol ?: 'USDT';
      $sidecar_data['expected_amount'] = $expected_amount ?: '0';
      $sidecar_data['expiration_minutes'] = $plugin ? $plugin->getExpirationMinutes() : 30;
      $sidecar_data['required_confirmations'] = $plugin ? $plugin->getConfirmationBlocks() : 1;
    }

    $address = static::callSidecar('derive', $sidecar_data);

    if (!$address) {
      return new JsonResponse(['error' => 'Failed to derive payment address'], 500);
    }

    $order_data = $commerce_order->getData('stablepay') ?? [];
    $order_data['receiving_address'] = $address;
    $order_data['expires_at'] = $expiresAt->format('c');
    if ($rpc_url && $token_address) {
      $order_data['rpc_url'] = $rpc_url;
      $order_data['token_address'] = $token_address;
      $order_data['token_symbol'] = $token_symbol ?: 'USDT';
      $order_data['expected_amount'] = $expected_amount ?: '0';
      $order_data['expiration_minutes'] = $plugin ? $plugin->getExpirationMinutes() : 30;
    }
    $commerce_order->setData('stablepay', $order_data);
    $commerce_order->save();

    return new JsonResponse([
      'address' => $address,
      'expiresAt' => $expiresAt->format('c'),
      'requiredConfirmations' => $plugin ? $plugin->getConfirmationBlocks() : 1,
    ]);
  }

  public static function callSidecar($action, $data = []) {
    $sidecar_url = getenv('STABLEPAY_SIDECAR_URL') ?: 'http://stablepay-listener:3001';
    try {
      $client = \Drupal::httpClient();
      $response = $client->post($sidecar_url . '/' . $action, [
        'json' => $data,
        'timeout' => 5,
      ]);
      $body = json_decode($response->getBody(), TRUE);
      return $body['address'] ?? NULL;
    } catch (\Exception $e) {
      \Drupal::logger('commerce_stablepay')->warning('Sidecar call failed: ' . $e->getMessage());
      return NULL;
    }
  }

  public static function callSidecarGet($action, $query = []) {
    $sidecar_url = getenv('STABLEPAY_SIDECAR_URL') ?: 'http://stablepay-listener:3001';
    try {
      $client = \Drupal::httpClient();
      $url = $sidecar_url . '/' . $action;
      if (!empty($query)) {
        $url .= '?' . http_build_query($query);
      }
      $response = $client->get($url, ['timeout' => 5]);
      return json_decode($response->getBody(), TRUE);
    } catch (\Exception $e) {
      \Drupal::logger('commerce_stablepay')->warning('Sidecar GET failed: ' . $e->getMessage());
      return NULL;
    }
  }

  public static function isValidAddress($address) {
    return is_string($address) && preg_match('/^0x[0-9a-fA-F]{40}$/', $address);
  }

  public static function fetchFiatToUsdRate($currency) {
    $cache = \Drupal::cache();
    $cid = 'commerce_stablepay:rate:' . $currency;
    if ($cached = $cache->get($cid)) {
      return $cached->data;
    }
    try {
      $client = \Drupal::httpClient();
      $response = $client->get('https://open.er-api.com/v6/latest/USD', [
        'timeout' => 5,
      ]);
      $body = json_decode($response->getBody(), TRUE);
      $rate = $body['rates'][$currency] ?? 0;
      if ($rate > 0) {
        $cache->set($cid, $rate, time() + 300);
      }
      return $rate;
    } catch (\Exception $e) {
      \Drupal::logger('commerce_stablepay')->warning('Rate fetch failed: ' . $e->getMessage());
      return 0;
    }
  }

  public function gatewayConfig() {
    $storage = $this->entityTypeManager()->getStorage('commerce_payment_gateway');
    $gateways = $storage->loadByProperties(['plugin' => 'stablepay_offsite']);
    $gateway = reset($gateways);
    if (!$gateway) {
      return new JsonResponse(['error' => 'StablePay gateway not configured'], 404);
    }

    $plugin = $gateway->getPlugin();
    $networks = [];

    if ($plugin->getMode() === 'test' && $plugin->getTestRpcUrl() && $plugin->getTestTokenAddress()) {
      $networks[] = [
        'name' => 'Test (' . $plugin->getTestTokenSymbol() . ')',
        'network' => 'test',
        'rpc_url' => $plugin->getTestRpcUrl(),
        'token_address' => $plugin->getTestTokenAddress(),
        'token_symbol' => $plugin->getTestTokenSymbol(),
        'chain_id' => 31337,
        'decimals' => 6,
        'required_confirmations' => 1,
        'expiration_minutes' => 60,
      ];
    }

    if ($plugin->getMode() === 'live') {
      if ($plugin->getStablechainRpc() && $plugin->getStablechainUsdt()) {
        $networks[] = [
          'name' => 'StableChain',
          'network' => 'stablechain',
          'rpc_url' => $plugin->getStablechainRpc(),
          'token_address' => $plugin->getStablechainUsdt(),
          'token_symbol' => 'USDC',
          'chain_id' => 988,
          'decimals' => 6,
          'required_confirmations' => $plugin->getConfirmationBlocks(),
          'expiration_minutes' => $plugin->getExpirationMinutes(),
        ];
      }
      if ($plugin->getCeloRpc() && $plugin->getCeloUsdc()) {
        $networks[] = [
          'name' => 'Celo',
          'network' => 'celo',
          'rpc_url' => $plugin->getCeloRpc(),
          'token_address' => $plugin->getCeloUsdc(),
          'token_symbol' => 'USDC',
          'chain_id' => 42220,
          'decimals' => 6,
          'required_confirmations' => min($plugin->getConfirmationBlocks(), 12),
          'expiration_minutes' => $plugin->getExpirationMinutes(),
        ];
      }
      if ($plugin->getCeloRpc() && $plugin->getCeloUsdt()) {
        $networks[] = [
          'name' => 'Celo',
          'network' => 'celo',
          'rpc_url' => $plugin->getCeloRpc(),
          'token_address' => $plugin->getCeloUsdt(),
          'token_symbol' => 'USDT',
          'chain_id' => 42220,
          'decimals' => 6,
          'required_confirmations' => min($plugin->getConfirmationBlocks(), 12),
          'expiration_minutes' => $plugin->getExpirationMinutes(),
        ];
      }
    }

    return new JsonResponse([
      'mode' => $plugin->getMode(),
      'notify_url' => Url::fromRoute('commerce_payment.notify', [
        'commerce_payment_gateway' => $gateway->id(),
      ])->setAbsolute()->toString(),
      'networks' => $networks,
    ]);
  }

}
