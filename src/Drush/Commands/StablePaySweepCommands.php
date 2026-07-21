<?php

namespace Drupal\commerce_stablepay\Drush\Commands;

use Drush\Attributes as CLI;
use Drush\Commands\DrushCommands;

class StablePaySweepCommands extends DrushCommands {

  #[CLI\Command(name: 'stablepay:sweep', aliases: ['sps'])]
  #[CLI\Argument(name: 'order_id', description: 'Order ID to check balance')]
  #[CLI\Usage(name: 'stablepay:sweep 200', description: 'Check balance for order 200')]
  public function sweep($order_id) {
    $order = \Drupal::entityTypeManager()->getStorage('commerce_order')->load($order_id);
    if (!$order) {
      $this->logger()->error('Order @id not found.', ['@id' => $order_id]);
      return;
    }

    $stablepay_data = $order->getData('stablepay');
    if (empty($stablepay_data['rpc_url']) || empty($stablepay_data['token_address'])) {
      $this->logger()->error('Order @id has no stablepay data (rpc_url or token_address missing).', ['@id' => $order_id]);
      return;
    }

    $sidecar_url = getenv('STABLEPAY_SIDECAR_URL') ?: 'http://stablepay-listener:3001';

    $client = \Drupal::httpClient();
    $balance_url = $sidecar_url . '/balance/' . $order_id
      . '?rpc_url=' . urlencode($stablepay_data['rpc_url'])
      . '&token_address=' . urlencode($stablepay_data['token_address'])
      . '&token_symbol=' . urlencode($stablepay_data['token_symbol'] ?: 'USDT')
      . '&expected_amount=0';

    try {
      $resp = $client->get($balance_url, ['timeout' => 5]);
      $balance_data = json_decode($resp->getBody(), TRUE);
    } catch (\Exception $e) {
      $this->logger()->error('Failed to check balance: ' . $e->getMessage());
      return;
    }

    if (!$balance_data || !$balance_data['found']) {
      $this->io()->writeln('Order @id: No balance found or address not funded.', ['@id' => $order_id]);
      return;
    }

    $balance = $balance_data['balance'];
    $symbol = $balance_data['token_symbol'] ?: 'USDT';
    $address = $balance_data['address'];

    $this->io()->writeln('Order #' . $order_id . ': ' . $balance . ' ' . $symbol . ' at ' . $address);
    $this->io()->writeln('To sweep, use: node tools/stablepay-sweep/index.js sweep-api --id ' . $order_id . ' --to <WALLET_ADDRESS>');
  }

}
