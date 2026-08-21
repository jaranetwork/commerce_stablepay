<?php

namespace Drupal\commerce_stablepay\Plugin\Commerce\CheckoutPane;

use Drupal\commerce_checkout\Attribute\CommerceCheckoutPane;
use Drupal\commerce_checkout\Plugin\Commerce\CheckoutPane\CheckoutPaneBase;
use Drupal\commerce\Response\NeedsRedirectException;
use Drupal\commerce_payment\Plugin\Commerce\PaymentGateway\ManualPaymentGatewayInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\Core\Url;

#[CommerceCheckoutPane(
  id: "stablepay_payment_process",
  label: new TranslatableMarkup("StablePay Payment process"),
  display_label: new TranslatableMarkup("StablePay"),
  default_step: "payment",
  wrapper_element: "container",
)]
class StablePayPaymentProcess extends CheckoutPaneBase {

  public function isVisible() {
    $payment_info_pane = $this->checkoutFlow->getPane('payment_information');
    if (!$payment_info_pane->isVisible() || $payment_info_pane->getStepId() == '_disabled') {
      return FALSE;
    }

    if ($this->order->getBalance()?->isZero()) {
      return FALSE;
    }

    return TRUE;
  }

  public function buildPaneForm(array $pane_form, FormStateInterface $form_state, array &$complete_form) {
    $selected_gateway = $this->getSelectedGatewayPluginId($form_state);
    if ($selected_gateway === 'stablepay_offsite') {
      $pane_form['message'] = [
        '#type' => 'markup',
        '#markup' => '<p>' . $this->t('Click "Pay and complete purchase" to proceed to the StablePay payment page.') . '</p>',
      ];
      return $pane_form;
    }

    $gateway = $this->order->get('payment_gateway')->entity;
    if ($gateway) {
      $plugin = $gateway->getPlugin();
      if ($plugin instanceof ManualPaymentGatewayInterface) {
        $payment = $this->entityTypeManager->getStorage('commerce_payment')->create([
          'state' => 'new',
          'amount' => $this->order->getBalance(),
          'payment_gateway' => $gateway->id(),
          'order_id' => $this->order->id(),
        ]);
        $plugin->createPayment($payment);
        $next = $this->checkoutFlow->getNextStepId($this->getStepId());
        $this->checkoutFlow->redirectToStep($next);
      }
    }

    return [];
  }

  public function submitPaneForm(array &$pane_form, FormStateInterface $form_state, array &$complete_form) {
    $payment_gateway = $this->loadPaymentGateway($form_state);
    if (!$payment_gateway || $payment_gateway->getPluginId() !== 'stablepay_offsite') {
      return;
    }

    $payment_storage = $this->entityTypeManager->getStorage('commerce_payment');
    $payment = $payment_storage->create([
      'state' => 'new',
      'amount' => $this->order->getBalance(),
      'payment_gateway' => $payment_gateway->id(),
      'order_id' => $this->order->id(),
    ]);
    $payment->save();

    $payment->set('state', 'pending');
    $payment->save();

    $this->order->setData('stablepay', [
      'amount' => $payment->getAmount()->getNumber(),
      'currency' => $payment->getAmount()->getCurrencyCode(),
      'created' => \Drupal::time()->getRequestTime(),
      'payment_id' => $payment->id(),
    ]);

    $this->order->save();

    $url = Url::fromRoute('commerce_stablepay.payment_page', [
      'commerce_order' => $this->order->id(),
    ])->setAbsolute()->toString();

    throw new NeedsRedirectException($url);
  }

  protected function getSelectedGatewayPluginId(FormStateInterface $form_state) {
    $gateway = $this->order->get('payment_gateway')->entity;
    if ($gateway) {
      return $gateway->getPluginId();
    }

    $values = $form_state->getValue('payment_information');
    if (is_array($values) && isset($values['payment_gateway'])) {
      $gateway = $this->entityTypeManager->getStorage('commerce_payment_gateway')->load($values['payment_gateway']);
      if ($gateway) {
        return $gateway->getPluginId();
      }
    }

    return NULL;
  }

  protected function loadPaymentGateway(FormStateInterface $form_state) {
    $gateway = $this->order->get('payment_gateway')->entity;
    if ($gateway) {
      return $gateway;
    }

    $values = $form_state->getValue('payment_information');
    if (is_array($values) && isset($values['payment_gateway'])) {
      return $this->entityTypeManager->getStorage('commerce_payment_gateway')->load($values['payment_gateway']);
    }

    return NULL;
  }

  public function buildPaneSummary() {
    return [];
  }

}
