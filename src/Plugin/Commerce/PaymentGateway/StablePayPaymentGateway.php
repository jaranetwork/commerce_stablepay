<?php

namespace Drupal\commerce_stablepay\Plugin\Commerce\PaymentGateway;

use Drupal\commerce_order\Entity\Order;
use Drupal\commerce_order\Entity\OrderInterface;
use Drupal\commerce_payment\Attribute\CommercePaymentGateway;
use Drupal\commerce_payment\Plugin\Commerce\PaymentGateway\PaymentGatewayBase;
use Drupal\commerce_payment\Plugin\Commerce\PaymentGateway\SupportsNotificationsInterface;
use Drupal\commerce_payment\Exception\PaymentGatewayException;
use Drupal\commerce_price\Price;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

#[CommercePaymentGateway(
  id: "stablepay_offsite",
  label: new TranslatableMarkup("StablePay"),
  display_label: new TranslatableMarkup("StablePay Crypto"),
  payment_type: "payment_manual",
  requires_billing_information: FALSE,
)]
class StablePayPaymentGateway extends PaymentGatewayBase implements SupportsNotificationsInterface {
  use StringTranslationTrait;

  public function getMode() {
    return $this->configuration['mode'] ?? 'test';
  }

  public function getStablechainRpc() {
    return $this->configuration['stablechain_rpc'] ?? '';
  }

  public function getCeloRpc() {
    return $this->configuration['celo_rpc'] ?? '';
  }

  public function getArbitrumRpc() {
    return $this->configuration['arbitrum_rpc'] ?? '';
  }

  public function getPolygonRpc() {
    return $this->configuration['polygon_rpc'] ?? '';
  }

  public function getStablechainUsdt() {
    return $this->configuration['stablechain_usdt'] ?? '';
  }

  public function getCeloUsdc() {
    return $this->configuration['celo_usdc'] ?? '';
  }

  public function getCeloUsdt() {
    return $this->configuration['celo_usdt'] ?? '';
  }

  public function getArbitrumUsdc() {
    return $this->configuration['arbitrum_usdc'] ?? '';
  }

  public function getArbitrumUsdt() {
    return $this->configuration['arbitrum_usdt'] ?? '';
  }

  public function getPolygonUsdc() {
    return $this->configuration['polygon_usdc'] ?? '';
  }

  public function getPolygonUsdt() {
    return $this->configuration['polygon_usdt'] ?? '';
  }

  public function getConfirmationBlocks() {
    return (int) ($this->configuration['confirmation_blocks'] ?? 1);
  }

  public function getExpirationMinutes() {
    return (int) ($this->configuration['expiration_minutes'] ?? 30);
  }

  public function getSweepAddress() {
    return $this->configuration['sweep_address'] ?? '';
  }

  public function getTestRpcUrl() {
    return $this->configuration['test_rpc_url'] ?? '';
  }

  public function getTestTokenSymbol() {
    return $this->configuration['test_token_symbol'] ?? 'USDC';
  }

  public function getTestTokenAddress() {
    return $this->configuration['test_token_address'] ?? '';
  }

  public function getFiatCurrency() {
    return $this->configuration['fiat_currency'] ?? 'PYG';
  }

  public function defaultConfiguration() {
    return [
      'mode' => 'test',
      'stablechain_rpc' => 'https://rpc.stable.xyz',
      'celo_rpc' => 'https://forno.celo.org',
      'stablechain_usdt' => '0x779Ded0c9e1022225f8E0630b35a9b54bE713736',
      'celo_usdc' => '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      'celo_usdt' => '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e',
      'arbitrum_rpc' => 'https://arb1.arbitrum.io/rpc',
      'polygon_rpc' => 'https://polygon-rpc.com',
      'arbitrum_usdc' => '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      'arbitrum_usdt' => '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      'polygon_usdc' => '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      'polygon_usdt' => '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      'confirmation_blocks' => 1,
      'expiration_minutes' => 30,
      'sweep_address' => '',
      'test_rpc_url' => 'http://host.docker.internal:8545',
      'test_token_symbol' => 'USDC',
      'test_token_address' => '',
      'fiat_currency' => 'PYG',
      'cancel_on_expire' => FALSE,
    ] + parent::defaultConfiguration();
  }

  public function buildConfigurationForm(array $form, FormStateInterface $form_state) {
    $form = parent::buildConfigurationForm($form, $form_state);

    $form['mode'] = [
      '#type' => 'select',
      '#title' => $this->t('Mode'),
      '#options' => ['test' => $this->t('Test'), 'live' => $this->t('Live')],
      '#default_value' => $this->configuration['mode'],
      '#required' => TRUE,
    ];

    $form['fiat_currency'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Fiat currency (ISO code)'),
      '#default_value' => $this->configuration['fiat_currency'],
      '#description' => $this->t('Store currency, e.g. PYG, USD, EUR. Used to convert to USDT.'),
      '#required' => TRUE,
      '#size' => 5,
    ];

    $form['stablechain_rpc'] = [
      '#type' => 'textfield',
      '#title' => $this->t('StableChain RPC URL'),
      '#default_value' => $this->configuration['stablechain_rpc'],
    ];

    $form['celo_rpc'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Celo RPC URL'),
      '#default_value' => $this->configuration['celo_rpc'],
    ];

    $form['stablechain_usdt'] = [
      '#type' => 'textfield',
      '#title' => $this->t('StableChain USDT Contract'),
      '#default_value' => $this->configuration['stablechain_usdt'],
    ];

    $form['celo_usdc'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Celo USDC Contract'),
      '#default_value' => $this->configuration['celo_usdc'],
    ];

    $form['celo_usdt'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Celo USDT Contract'),
      '#default_value' => $this->configuration['celo_usdt'],
    ];

    $form['arbitrum_rpc'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Arbitrum RPC URL'),
      '#default_value' => $this->configuration['arbitrum_rpc'],
    ];

    $form['arbitrum_usdc'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Arbitrum USDC Contract'),
      '#default_value' => $this->configuration['arbitrum_usdc'],
    ];

    $form['arbitrum_usdt'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Arbitrum USDT Contract'),
      '#default_value' => $this->configuration['arbitrum_usdt'],
    ];

    $form['polygon_rpc'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Polygon RPC URL'),
      '#default_value' => $this->configuration['polygon_rpc'],
    ];

    $form['polygon_usdc'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Polygon USDC Contract'),
      '#default_value' => $this->configuration['polygon_usdc'],
    ];

    $form['polygon_usdt'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Polygon USDT Contract'),
      '#default_value' => $this->configuration['polygon_usdt'],
    ];

    $form['confirmation_blocks'] = [
      '#type' => 'number',
      '#title' => $this->t('Required Confirmations'),
      '#default_value' => $this->configuration['confirmation_blocks'],
      '#required' => TRUE,
      '#min' => 1,
    ];

    $form['expiration_minutes'] = [
      '#type' => 'number',
      '#title' => $this->t('Expiration (minutes)'),
      '#default_value' => $this->configuration['expiration_minutes'],
      '#required' => TRUE,
      '#min' => 1,
    ];

    $form['cancel_on_expire'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Cancel order on payment expiration'),
      '#default_value' => $this->configuration['cancel_on_expire'],
      '#description' => $this->t('When enabled, the order will be automatically canceled when the crypto payment expires.'),
    ];

    $form['sweep_address'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Sweep Address (master wallet)'),
      '#default_value' => $this->configuration['sweep_address'],
      '#description' => $this->t('Optional: funds received will be swept to this address.'),
    ];

    $form['test_rpc_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Test RPC URL (foundry-mock / anvil)'),
      '#default_value' => $this->configuration['test_rpc_url'] ?? 'http://host.docker.internal:8545',
      '#description' => $this->t('Only used in Test mode.'),
    ];

    $form['test_token_symbol'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Test Token Symbol'),
      '#default_value' => $this->configuration['test_token_symbol'] ?? 'USDC',
      '#description' => $this->t('Only used in Test mode.'),
    ];

    $form['test_token_address'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Test Token Contract Address'),
      '#default_value' => $this->configuration['test_token_address'] ?? '',
      '#description' => $this->t('Only used in Test mode.'),
    ];

    return $form;
  }

  public function submitConfigurationForm(array &$form, FormStateInterface $form_state) {
    parent::submitConfigurationForm($form, $form_state);
    if (!$form_state->getErrors()) {
      $values = $form_state->getValue($form['#parents']);
      $this->configuration['mode'] = $values['mode'];
      $this->configuration['stablechain_rpc'] = $values['stablechain_rpc'];
      $this->configuration['celo_rpc'] = $values['celo_rpc'];
      $this->configuration['stablechain_usdt'] = $values['stablechain_usdt'];
      $this->configuration['celo_usdc'] = $values['celo_usdc'];
      $this->configuration['celo_usdt'] = $values['celo_usdt'];
      $this->configuration['arbitrum_rpc'] = $values['arbitrum_rpc'];
      $this->configuration['arbitrum_usdc'] = $values['arbitrum_usdc'];
      $this->configuration['arbitrum_usdt'] = $values['arbitrum_usdt'];
      $this->configuration['polygon_rpc'] = $values['polygon_rpc'];
      $this->configuration['polygon_usdc'] = $values['polygon_usdc'];
      $this->configuration['polygon_usdt'] = $values['polygon_usdt'];
      $this->configuration['confirmation_blocks'] = $values['confirmation_blocks'];
      $this->configuration['expiration_minutes'] = $values['expiration_minutes'];
      $this->configuration['sweep_address'] = $values['sweep_address'];
      $this->configuration['test_rpc_url'] = $values['test_rpc_url'];
      $this->configuration['test_token_symbol'] = $values['test_token_symbol'];
      $this->configuration['test_token_address'] = $values['test_token_address'];
      $this->configuration['fiat_currency'] = $values['fiat_currency'];
      $this->configuration['cancel_on_expire'] = !empty($values['cancel_on_expire']);
    }
  }

  public function getNotifyUrl() {
    return Url::fromRoute('commerce_payment.notify', [
      'commerce_payment_gateway' => $this->parentEntity->id(),
    ])->setAbsolute()->toString();
  }

  public function onNotify(Request $request) {
    $logger = \Drupal::logger('commerce_stablepay');

    // Verify webhook secret — only accept from our sidecar.
    $expected_secret = getenv('STABLEPAY_WEBHOOK_SECRET');
    if ($expected_secret) {
      $provided_secret = $request->headers->get('X-Webhook-Secret');
      if ($provided_secret !== $expected_secret) {
        $logger->warning('Rejected notify with invalid webhook secret');
        return;
      }
    }

    $payload = json_decode($request->getContent(), TRUE);

    // Handle expiration notification from sidecar
    if (!empty($payload['order_id']) && ($payload['event'] ?? '') === 'expired') {
      $order = Order::load($payload['order_id']);
      if (!$order) {
        $logger->warning('Expiration notify: order not found: ' . $payload['order_id']);
        return new JsonResponse(['status' => 'not_found']);
      }
      $current_state = $order->get('state')->first()->getValue()['value'] ?? '';
      if ($current_state !== 'draft') {
        $logger->info('Expiration notify: order ' . $order->id() . ' already in state: ' . $current_state);
        return new JsonResponse(['status' => 'ignored']);
      }
      if (!empty($this->configuration['cancel_on_expire'])) {
        $state_item = $order->get('state')->first();
        $transitions = $state_item->getTransitions();
        if (isset($transitions['cancel'])) {
          $state_item->applyTransition($transitions['cancel']);
        }
        if ($order->isLocked()) {
          $order->unlock();
        }
        $order->save();
        $payment_storage = $this->entityTypeManager->getStorage('commerce_payment');
        $payments = $payment_storage->loadByProperties([
          'order_id' => $order->id(),
          'state' => 'pending',
        ]);
        foreach ($payments as $payment) {
          $ptransitions = $payment->getState()->getTransitions();
          if (isset($ptransitions['void'])) {
            $payment->getState()->applyTransition($ptransitions['void']);
            $payment->save();
          }
        }
        $logger->notice('Order ' . $order->id() . ' canceled: payment expired');
        return new JsonResponse(['status' => 'canceled']);
      }
      $logger->info('Expiration notify: order ' . $order->id() . ' expired but cancel_on_expire is disabled');
      return new JsonResponse(['status' => 'ignored']);
    }

    if (!$payload || empty($payload['order_id']) || empty($payload['tx_hash'])) {
      throw new PaymentGatewayException('Invalid notification payload.');
    }

    $order = Order::load($payload['order_id']);
    if (!$order) {
      throw new PaymentGatewayException('Order not found: ' . $payload['order_id']);
    }

    $payment_storage = $this->entityTypeManager->getStorage('commerce_payment');

    $existing = $payment_storage->loadByProperties([
      'order_id' => $order->id(),
      'remote_id' => $payload['tx_hash'],
    ]);

    if (!empty($existing)) {
      $logger->info('Duplicate notification for tx: ' . $payload['tx_hash']);
      return;
    }

    // Verify tx_hash on-chain via sidecar before accepting.
    $stablepay_data = $order->getData('stablepay');
    if (!empty($stablepay_data['rpc_url']) && !empty($stablepay_data['token_address'])) {
      $sidecar_url = getenv('STABLEPAY_SIDECAR_URL') ?: 'http://stablepay-listener:3001';
      $verified = $this->verifyTxHash($sidecar_url, $order->id(), $payload['tx_hash'], $stablepay_data);
      if (!$verified) {
        $logger->warning('Rejected unverified tx_hash ' . $payload['tx_hash'] . ' for order ' . $order->id());
        return;
      }
    }

    $payments = $payment_storage->loadByProperties([
      'order_id' => $order->id(),
      'state' => 'pending',
    ]);

    if (!empty($payments)) {
      $payment = reset($payments);
      $payment->state = 'completed';
      $payment->setRemoteId($payload['tx_hash']);
      $payment->setRemoteState('confirmed');
      $payment->save();
    }
    else {
      $payment = $payment_storage->create([
        'state' => 'completed',
        'amount' => new Price($payload['amount'], $order->getTotalPaid()->getCurrencyCode()),
        'payment_gateway' => $this->parentEntity->id(),
        'order_id' => $order->id(),
        'remote_id' => $payload['tx_hash'],
        'remote_state' => 'confirmed',
      ]);
      $payment->save();
    }

    if ($order->get('state')->first()->getValue()['value'] === 'draft') {
      $state_item = $order->get('state')->first();
      if ($transitions = $state_item->getTransitions()) {
        $state_item->applyTransition(current($transitions));
        if ($order->isLocked()) {
          $order->unlock();
        }
        $order->save();
      }
    }

    $logger->info('Payment completed for order ' . $order->id() . ', tx: ' . $payload['tx_hash']);
  }

  /**
   * Verify tx_hash exists on-chain via sidecar /get-tx endpoint.
   */
  private function verifyTxHash($sidecar_url, $order_id, $tx_hash, $stablepay_data) {
    try {
      $client = \Drupal::httpClient();
      $url = $sidecar_url . '/get-tx/' . $order_id
        . '?rpc_url=' . urlencode($stablepay_data['rpc_url'])
        . '&token_address=' . urlencode($stablepay_data['token_address']);
      $response = $client->get($url, ['timeout' => 10]);
      $body = json_decode($response->getBody(), TRUE);
      if (!empty($body['tx_hash']) && strtolower($body['tx_hash']) === strtolower($tx_hash)) {
        return TRUE;
      }
      return FALSE;
    } catch (\Exception $e) {
      \Drupal::logger('commerce_stablepay')->warning('Tx verification failed: ' . $e->getMessage());
      return FALSE;
    }
  }

}
