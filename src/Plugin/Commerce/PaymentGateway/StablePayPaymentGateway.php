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
use Symfony\Component\HttpFoundation\Request;

#[CommercePaymentGateway(
  id: "stablepay_offsite",
  label: new TranslatableMarkup("StablePay"),
  display_label: new TranslatableMarkup("StablePay Crypto"),
  payment_type: "payment_default",
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

  public function getStablechainUsdc() {
    return $this->configuration['stablechain_usdc'] ?? '';
  }

  public function getCeloUsdc() {
    return $this->configuration['celo_usdc'] ?? '';
  }

  public function getCeloUsdt() {
    return $this->configuration['celo_usdt'] ?? '';
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
      'stablechain_rpc' => 'https://rpc.stablechain.com',
      'celo_rpc' => 'https://rpc.celo.org',
      'stablechain_usdc' => '',
      'celo_usdc' => '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      'celo_usdt' => '',
      'confirmation_blocks' => 1,
      'expiration_minutes' => 30,
      'sweep_address' => '',
      'test_rpc_url' => 'http://host.docker.internal:8545',
      'test_token_symbol' => 'USDC',
      'test_token_address' => '',
      'fiat_currency' => 'PYG',
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

    $form['stablechain_usdc'] = [
      '#type' => 'textfield',
      '#title' => $this->t('StableChain USDC Contract'),
      '#default_value' => $this->configuration['stablechain_usdc'],
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
      '#min' => 5,
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
      $this->configuration['stablechain_usdc'] = $values['stablechain_usdc'];
      $this->configuration['celo_usdc'] = $values['celo_usdc'];
      $this->configuration['celo_usdt'] = $values['celo_usdt'];
      $this->configuration['confirmation_blocks'] = $values['confirmation_blocks'];
      $this->configuration['expiration_minutes'] = $values['expiration_minutes'];
      $this->configuration['sweep_address'] = $values['sweep_address'];
      $this->configuration['test_rpc_url'] = $values['test_rpc_url'];
      $this->configuration['test_token_symbol'] = $values['test_token_symbol'];
      $this->configuration['test_token_address'] = $values['test_token_address'];
      $this->configuration['fiat_currency'] = $values['fiat_currency'];
    }
  }

  public function getNotifyUrl() {
    return Url::fromRoute('commerce_payment.notify', [
      'commerce_payment_gateway' => $this->parentEntity->id(),
    ])->setAbsolute()->toString();
  }

  public function onNotify(Request $request) {
    $logger = \Drupal::logger('commerce_stablepay');

    $payload = json_decode($request->getContent(), TRUE);
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
