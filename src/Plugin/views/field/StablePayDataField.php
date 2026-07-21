<?php

namespace Drupal\commerce_stablepay\Plugin\views\field;

use Drupal\views\Plugin\views\field\FieldPluginBase;
use Drupal\views\ViewExecutable;
use Drupal\views\Plugin\views\display\DisplayPluginBase;
use Drupal\views\ResultRow;

/**
 * A handler to provide a field that extracts a value from the order's
 * stablepay data array.
 *
 * @ViewsField("stablepay_data_field")
 */
class StablePayDataField extends FieldPluginBase {

  /**
   * {@inheritdoc}
   */
  public function init(ViewExecutable $view, DisplayPluginBase $display, array &$options = NULL) {
    parent::init($view, $display, $options);
    // The stablepay_key is defined in hook_views_data_alter() but Views
    // does not automatically merge it into the plugin options.
    if (empty($this->options['stablepay_key']) && !empty($this->definition['stablepay_key'])) {
      $this->options['stablepay_key'] = $this->definition['stablepay_key'];
    }
  }

  /**
   * {@inheritdoc}
   */
  public function query() {
    // Pseudo field — data is in a serialized blob, no SQL query needed.
  }

  /**
   * {@inheritdoc}
   */
  protected function defineOptions() {
    $options = parent::defineOptions();
    $options['stablepay_key'] = ['default' => ''];
    return $options;
  }

  /**
   * {@inheritdoc}
   */
  public function render(ResultRow $values) {
    $entity = $values->_entity ?? NULL;
    if (!$entity) {
      return '';
    }

    $data = $entity->getData('stablepay');
    $key = $this->options['stablepay_key'];

    if (!empty($data[$key])) {
      return $data[$key];
    }

    return '';
  }

}
