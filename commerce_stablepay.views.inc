<?php

/**
 * @file
 * Exposes StablePay order data fields to Views.
 */

/**
 * Implements hook_views_data_alter().
 */
function commerce_stablepay_views_data_alter(array &$data) {
  $fields = [
    'stablepay_receiving_address' => [
      'label' => t('Receiving Address'),
      'key' => 'receiving_address',
    ],
    'stablepay_token_symbol' => [
      'label' => t('Token Symbol'),
      'key' => 'token_symbol',
    ],
    'stablepay_token_address' => [
      'label' => t('Token Address'),
      'key' => 'token_address',
    ],
  ];

  foreach ($fields as $id => $info) {
    $data['commerce_order'][$id] = [
      'title' => $info['label'],
      'help' => t('StablePay: @label from order stablepay data.', ['@label' => $info['label']]),
      'field' => [
        'id' => 'stablepay_data_field',
        'stablepay_key' => $info['key'],
      ],
    ];
  }
}
