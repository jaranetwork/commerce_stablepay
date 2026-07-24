<?php

namespace Drupal\commerce_stablepay\Plugin\Commerce\PaymentGateway;

interface StablePayPaymentGatewayInterface {

  public function getMode();

  public function getStablechainRpc();

  public function getCeloRpc();

  public function getStablechainUsdt();

  public function getCeloUsdc();

  public function getCeloUsdt();

  public function getConfirmationBlocks();

  public function getExpirationMinutes();

  public function getSweepAddress();

  public function getTestRpcUrl();

  public function getTestTokenSymbol();

  public function getTestTokenAddress();

}
