(function ($, Drupal, drupalSettings, once) {
  'use strict';

  Drupal.behaviors.stablepayCheckout = {
    attach: function (context) {
      once('stablepayCheckout', '#stablepay-container', context).forEach(function (container) {
        var data = container.dataset;
        var networks = JSON.parse(data.networks || '[]');
        var orderId = data.orderId;
        var amount = parseFloat(data.amount);
        var currency = data.currency;
        var statusUrl = data.statusUrl;
        var notifyUrl = data.notifyUrl;
        var returnUrl = data.returnUrl;
        var initialBalance = JSON.parse(data.onchainBalance || 'null');
        var cancelOnExpire = drupalSettings.stablepay && drupalSettings.stablepay.cancel_on_expire;

        if (networks.length === 0) {
          container.innerHTML = '<p style="color: var(--danger); text-align: center;">No payment networks configured.</p>';
          return;
        }

        var state = {
          step: 'select-token',
          selectedToken: null,
          payment: null,
          status: 'pending',
          txHash: null,
          confirmations: 0,
          requiredConfirmations: 1,
          amountReceived: 0,
          timer: '',
          qrMode: 'address',
          error: null,
        };

        if (initialBalance && !isNaN(parseFloat(initialBalance.balance))) {
          state.amountReceived = parseFloat(initialBalance.balance);
        }

        var pollInterval = null;
        var timerInterval = null;

        function render() {
          container.innerHTML = renderContent();
          attachHandlers();
          if (state.payment && state.payment.receivingAddress && state.payment.receivingAddress !== 'generating...' && state.payment.receivingAddress !== '0x0000000000000000000000000000000000000000') {
            generateQR();
          }
        }

        function renderContent() {
          var html = '';

          if (!state.payment) {
            html += renderNetworkSelection();
          } else {
            html += renderPaymentScreen();
          }

          return html;
        }

        function renderNetworkSelection() {
          var tokens = getAvailableTokens(networks);
          var html = '';

          if (!state.selectedToken) {
            html += '<h2 style="margin-bottom: 0.25rem; font-size: 1.25rem;">Crypto Payment</h2>';
            html += '<div style="font-size: 1.75rem; font-weight: bold; margin-bottom: 0.25rem;">$' + amount.toFixed(2) + ' USD</div>';
            html += '<p style="font-size: 0.875rem; color: var(--text-secondary, #666); margin-bottom: 1.5rem;">Select token to pay with</p>';

            if (state.error) {
              html += '<div class="alert alert-error" style="padding: 0.75rem; border-radius: 8px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; margin-bottom: 1rem;">' + escapeHtml(state.error) + '</div>';
            }

            html += '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';
            tokens.forEach(function (token) {
              var count = networks.filter(function (n) { return n.tokenSymbol === token; }).length;
              html += '<button type="button" class="stablepay-btn-option" data-token="' + escapeHtml(token) + '" style="display: flex; justify-content: space-between; align-items: center; padding: 1.25rem; border-radius: 12px; border: 2px solid var(--border, #e5e7eb); background: var(--background, #f9fafb); cursor: pointer; color: var(--text, #111); font-size: 0.875rem; text-align: left; transition: border-color 0.15s; width: 100%;">';
              html += '<div><div style="font-size: 1.125rem; font-weight: 700;">' + escapeHtml(token) + '</div></div>';
              html += '<div style="font-size: 0.75rem; color: var(--text-secondary, #666);">' + count + ' network' + (count > 1 ? 's' : '') + '</div>';
              html += '</button>';
            });
            html += '</div>';
          } else {
            var filtered = networks.filter(function (n) { return n.tokenSymbol === state.selectedToken; });
            html += '<h2 style="margin-bottom: 0.5rem; font-size: 1.25rem;">' + escapeHtml(state.selectedToken) + ' Network</h2>';
            html += '<p style="font-size: 0.875rem; color: var(--text-secondary, #666); margin-bottom: 1.5rem;">Select network</p>';

            if (state.error) {
              html += '<div class="alert alert-error" style="padding: 0.75rem; border-radius: 8px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; margin-bottom: 1rem;">' + escapeHtml(state.error) + '</div>';
            }

            html += '<button type="button" class="stablepay-btn-back" style="display: inline-flex; align-items: center; gap: 0.25rem; background: none; border: none; cursor: pointer; color: var(--primary, #2563eb); font-size: 0.75rem; padding: 0 0 0.75rem 0;">← Change token</button>';

            html += '<div style="display: flex; flex-direction: column; gap: 0.75rem;">';
            filtered.forEach(function (net, i) {
              html += '<button type="button" class="stablepay-btn-network" data-network="' + i + '" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-radius: 8px; border: 1px solid var(--border, #e5e7eb); background: var(--background, #f9fafb); cursor: pointer; color: var(--text, #111); font-size: 0.875rem; text-align: left; width: 100%;">';
              html += '<div><div style="font-weight: 600;">' + escapeHtml(net.name || net.network) + '</div>';
              html += '<div style="font-size: 0.75rem; color: var(--text-secondary, #666); margin-top: 0.25rem;">' + escapeHtml(net.network) + '</div></div>';
              html += '<div style="font-size: 0.75rem; color: var(--primary, #2563eb);">$' + amount.toFixed(2) + '</div>';
              html += '</button>';
            });
            html += '</div>';
          }

          return html;
        }

        function renderPaymentScreen() {
          try {
          var p = state.payment;
          var netColor = p.network === 'celo' ? '#35d07f' : '#6366f1';
          var netUrl = p.network === 'celo' ? 'https://celo.org/' : 'https://www.stable.xyz/';
          var isExpired = state.status === 'expired';
          var isConfirmed = state.status === 'confirmed';

          var html = '';
          html += '<style>@keyframes spin { to { transform: rotate(360deg); } } .crypto-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--text-muted, #999); border-top-color: var(--primary, #2563eb); border-radius: 50%; animation: spin 0.8s linear infinite; }</style>';

          html += '<h2 style="margin-bottom: 0.5rem; font-size: 1.25rem;">Crypto Payment</h2>';

          if (!isConfirmed && !isExpired) {
            html += '<p style="font-size: 0.875rem; color: var(--text-secondary, #666); margin-bottom: 1.5rem;">Send the exact amount to the address below</p>';

            html += '<div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--background, #f9fafb); border-radius: 8px; margin-bottom: 0.75rem;">';
            html += '<div><div style="font-size: 0.75rem; color: var(--text-muted, #999); margin-bottom: 0.25rem;">Amount</div>';
            html += '<div style="font-size: 1.5rem; font-weight: bold;">$' + p.amount.toFixed(2) + ' <span style="font-size: 1rem; color: var(--text-secondary, #666);">' + escapeHtml(p.tokenSymbol) + '</span></div></div>';
            html += '<div style="text-align: right;"><div style="font-size: 0.75rem; color: var(--text-muted, #999); margin-bottom: 0.25rem;">Network</div>';
            html += '<a href="' + netUrl + '" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 0.25rem 0.6rem; border-radius: 999px; background: ' + netColor + '; color: #fff; font-weight: 700; font-size: 0.75rem; text-transform: capitalize; text-decoration: none;">' + escapeHtml(p.network) + '</a>';
            html += '<div style="font-size: 0.75rem; color: ' + (state.timer === 'Expired' ? '#dc2626' : 'var(--text-secondary, #666)') + '; margin-top: 0.35rem;">' + state.timer + '</div></div></div>';

            var statusBg = state.amountReceived > 0 ? '#ca8a04' : '#f0f0f0';
            html += '<div style="padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; background: ' + statusBg + '; color: var(--text, #111); border: 1px solid ' + (state.amountReceived > 0 ? '#ca8a04' : '#ccc') + ';">';
            html += '<div style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">';
            if (state.amountReceived > 0) {
              var remaining = Math.max(0, p.amount - state.amountReceived);
              html += '<div><span>Received</span> <span style="font-size: 1.125rem;">' + state.amountReceived.toFixed(2) + '</span> / <span>' + p.amount.toFixed(2) + '</span> <span>' + escapeHtml(p.tokenSymbol) + '</span></div>';
              html += '<div style="font-size: 0.75rem; color: var(--text-muted, #999); margin-top: 0.25rem;">Remaining: ' + remaining.toFixed(2) + ' ' + escapeHtml(p.tokenSymbol) + '</div>';
            } else {
              html += 'Awaiting payment <span class="crypto-spinner"></span>';
            }
            html += '</div></div>';

            html += '<div style="display: flex; align-items: center; gap: 0.5rem; justify-content: center; margin-bottom: 0.75rem;">';
            html += '<span style="display: inline-block; padding: 0.2rem 0.5rem; border-radius: 4px; background: ' + netColor + '; color: #fff; font-weight: 700; font-size: 0.7rem; text-transform: uppercase;">' + escapeHtml(p.network) + '</span>';
            html += '<a href="' + netUrl + '" target="_blank" rel="noopener noreferrer" style="font-size: 0.75rem; color: var(--text-secondary, #666); text-decoration: underline;">Send on ' + escapeHtml(p.network) + '</a></div>';

            html += '<div style="display: flex; gap: 0.25rem; justify-content: center; margin-bottom: 0.75rem;">';
            html += '<button type="button" class="stablepay-qr-mode" data-mode="address" style="padding: 0.3rem 0.75rem; border-radius: 6px; border: 1px solid var(--border, #e5e7eb); background: ' + (state.qrMode === 'address' ? 'var(--primary, #2563eb)' : 'var(--background, #f9fafb)') + '; color: ' + (state.qrMode === 'address' ? '#fff' : 'var(--text-secondary, #666)') + '; cursor: pointer; font-size: 0.75rem; font-weight: 600;">Address</button>';
            html += '<button type="button" class="stablepay-qr-mode" data-mode="eip681" style="padding: 0.3rem 0.75rem; border-radius: 6px; border: 1px solid var(--border, #e5e7eb); background: ' + (state.qrMode === 'eip681' ? 'var(--primary, #2563eb)' : 'var(--background, #f9fafb)') + '; color: ' + (state.qrMode === 'eip681' ? '#fff' : 'var(--text-secondary, #666)') + '; cursor: pointer; font-size: 0.75rem; font-weight: 600;">EIP-681</button></div>';

            html += '<div style="display: flex; justify-content: center; margin-bottom: 1.5rem;">';
            html += '<div id="stablepay-qr" style="width: 180px; height: 180px; background: #fff; border-radius: 8px;"></div></div>';

            html += '<div style="padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; background: #fff3cd; border: 1px solid #ffc107; color: #856404; font-size: 0.8rem; font-weight: 500; line-height: 1.4;">';
            html += '⚠️ Only send <strong>' + escapeHtml(p.tokenSymbol) + '</strong> on the <strong>' + escapeHtml(p.network) + '</strong> network. Sending other tokens or using a different network may result in permanent loss.</div>';

            html += '<div style="margin-bottom: 1.5rem;">';
            html += '<label style="font-size: 0.75rem; color: var(--text-muted, #999); margin-bottom: 0.25rem; display: block;">Send to address</label>';
            html += '<div style="display: flex; gap: 0.5rem; padding: 0.75rem; background: var(--background, #f9fafb); border-radius: 8px; border: 1px solid var(--border, #e5e7eb); font-family: monospace; font-size: 0.75rem; word-break: break-all;">';
            html += '<span style="flex: 1;">' + escapeHtml(p.receivingAddress) + '</span>';
            html += '<button type="button" class="stablepay-btn-copy" style="background: none; border: none; cursor: pointer; color: var(--primary, #2563eb); font-size: 0.75rem; font-weight: 600; white-space: nowrap;">Copy</button></div></div>';

            if (state.hasMetaMask) {
              html += '<button type="button" class="stablepay-btn-metamask" style="display: block; width: 100%; padding: 0.75rem; margin-top: 0.75rem; background: #f6851b; color: #fff; border: none; border-radius: 8px; font-size: 0.875rem; font-weight: 600; cursor: pointer;">Pay with MetaMask</button>';
            }
          }

          if (state.status === 'confirmed') {
            var statusBg = '#16a34a';
            html += '<div style="padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; background: ' + statusBg + '; color: #fff;">';
            html += '<div style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">Payment confirmed!</div>';
            if (state.txHash) {
              var explorerUrl = (p.network === 'celo' ? 'https://celoscan.io/tx/' : 'https://stablescan.xyz/tx/') + state.txHash;
              html += '<a href="' + explorerUrl + '" target="_blank" rel="noopener noreferrer" style="font-size: 0.75rem; color: #fff; text-decoration: underline;">View on Explorer</a>';
            }
            html += '</div>';
            html += '<a href="' + escapeHtml(returnUrl) + '" class="btn btn-primary" style="display: block; width: 100%; padding: 0.75rem; text-align: center; background: var(--primary, #2563eb); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600;">Continue</a>';
          }

          if (state.status === 'expired') {
            html += '<div style="padding: 1rem; border-radius: 8px; background: #dc2626; color: #fff;">';
            html += '<div style="font-weight: 600;">Payment expired</div></div>';
            if (state.canceled) {
              html += '<a href="/cart" style="display: block; margin-top: 1rem; padding: 0.75rem; text-align: center; background: #374151; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600;">Volver al carrito</a>';
            }
          }

          return html;
        } catch (e) {
          console.error('renderPaymentScreen error:', e, 'state:', JSON.parse(JSON.stringify(state)));
          return '<div style="color:red;padding:1rem;">Render error: ' + escapeHtml(e.message) + '</div>';
        }
        }

        function getAvailableTokens(networks) {
          var seen = {};
          var result = [];
          networks.forEach(function (n) {
            if (!seen[n.tokenSymbol]) {
              seen[n.tokenSymbol] = true;
              result.push(n.tokenSymbol);
            }
          });
          return result.sort();
        }

        function escapeHtml(str) {
          if (!str) return '';
          var div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }

        function attachHandlers() {
          var container = document.getElementById('stablepay-container');
          if (!container) return;

          container.querySelectorAll('.stablepay-btn-option').forEach(function (btn) {
            btn.addEventListener('click', function () {
              state.selectedToken = btn.dataset.token;
              state.error = null;
              render();
            });
          });

          container.querySelectorAll('.stablepay-btn-back').forEach(function (btn) {
            btn.addEventListener('click', function () {
              state.selectedToken = null;
              state.error = null;
              render();
            });
          });

          container.querySelectorAll('.stablepay-btn-network').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var idx = parseInt(btn.dataset.network);
              var net = networks[idx];
              if (net) {
                createPayment(net);
              }
            });
          });

          container.querySelectorAll('.stablepay-btn-copy').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var addr = state.payment ? state.payment.receivingAddress : '';
              if (addr && navigator.clipboard) {
                navigator.clipboard.writeText(addr);
                btn.textContent = 'Copied!';
                setTimeout(function () { btn.textContent = 'Copy'; }, 2000);
              }
            });
          });

          container.querySelectorAll('.stablepay-qr-mode').forEach(function (btn) {
            btn.addEventListener('click', function () {
              state.qrMode = btn.dataset.mode;
              render();
              generateQR();
            });
          });

          container.querySelectorAll('.stablepay-btn-metamask').forEach(function (btn) {
            btn.addEventListener('click', async function () {
              try {
                var p = state.payment;
                var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                var from = accounts[0];
                var decimals = p.decimals || 6;
                var amount = BigInt(Math.round(p.amount * Math.pow(10, decimals)));
                var toPadded = p.receivingAddress.slice(2).padStart(64, '0');
                var amountPadded = amount.toString(16).padStart(64, '0');
                var data = '0xa9059cbb' + toPadded + amountPadded;
                var txHash = await window.ethereum.request({
                  method: 'eth_sendTransaction',
                  params: [{ from: from, to: p.tokenAddress, data: data }]
                });
                state.txHash = txHash;
                state.status = 'pending';
                render();
              } catch (e) {
                state.error = e.message;
                render();
              }
            });
          });
        }

        function createPayment(net) {
          state.error = null;
          state.payment = { orderId: orderId, amount: amount, tokenSymbol: net.tokenSymbol, tokenAddress: net.tokenAddress, rpcUrl: net.rpcUrl, network: net.network, decimals: net.decimals || 6, chainId: net.chainId || 1, requiredConfirmations: net.requiredConfirmations || 1, expirationMinutes: net.expirationMinutes || 30 };
          state.payment.receivingAddress = (container.dataset.address) || (drupalSettings.stablepay && drupalSettings.stablepay.address) || 'generating...';
          state.payment.expiresAt = new Date(Date.now() + (net.expirationMinutes || 30) * 60 * 1000).toISOString();
          state.hasMetaMask = typeof window.ethereum !== 'undefined';
          render();
          generateQR();
          startPolling();
          startTimer();

          // Register for sidecar monitoring (address already derived by build())
          var url = drupalSettings.path && drupalSettings.path.baseUrl ? drupalSettings.path.baseUrl : '/';
          url = url.replace(/\/+$/, '');
          var deriveUrl = url + '/stablepay/payment/derive-address/' + orderId
            + '?rpc_url=' + encodeURIComponent(net.rpcUrl)
            + '&token_address=' + encodeURIComponent(net.tokenAddress)
            + '&token_symbol=' + encodeURIComponent(net.tokenSymbol)
            + '&amount=' + encodeURIComponent(amount.toFixed(2));
          $.ajax({
            url: window.location.origin + deriveUrl,
            method: 'GET',
            success: function (addrResp) {
              if (addrResp.expiresAt) {
                state.payment.expiresAt = addrResp.expiresAt;
              }
              if (addrResp.requiredConfirmations) {
                state.requiredConfirmations = addrResp.requiredConfirmations;
              }
            },
            error: function () {
              // Non-critical — address already in DOM
            }
          });
        }

        function generateQR() {
          var qrContainer = document.getElementById('stablepay-qr');
          if (!qrContainer || !state.payment) return;

          var value = state.qrMode === 'eip681'
            ? 'ethereum:' + state.payment.tokenAddress + '@' + state.payment.chainId + '/transfer?address=' + state.payment.receivingAddress + '&uint256=' + (parseInt(state.payment.amount * Math.pow(10, state.payment.decimals || 6)) || 0)
            : state.payment.receivingAddress;

          qrContainer.innerHTML = '';

          // Simple QR fallback — use Google Charts API
          var img = document.createElement('img');
          img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(value);
          img.alt = 'QR Code';
          img.style.width = '180px';
          img.style.height = '180px';
          img.style.borderRadius = '8px';
          qrContainer.appendChild(img);
        }

        function startPolling() {
          if (pollInterval) clearInterval(pollInterval);

          var url = drupalSettings.path && drupalSettings.path.baseUrl ? drupalSettings.path.baseUrl : '/';
          url = url.replace(/\/+$/, '');
          var statusFullUrl = window.location.origin + url + '/stablepay/payment/status/' + orderId;

          pollInterval = setInterval(function () {
            $.ajax({
              url: statusFullUrl,
              method: 'GET',
              success: function (resp) {
                if (resp.onchain_balance) {
                  state.amountReceived = parseFloat(resp.onchain_balance.balance) || 0;
                  if (state.status !== 'expired' && state.status !== 'confirmed') {
                    state.status = 'pending';
                  }
                  render();
                }
                if (resp.order_state === 'canceled') {
                  state.status = 'expired';
                  state.canceled = true;
                  render();
                  if (pollInterval) clearInterval(pollInterval);
                  return;
                }
                if (resp.order_state !== 'draft' && resp.order_state !== 'checkout') {
                  state.status = 'confirmed';
                  state.txHash = resp.payments && resp.payments.length > 0 ? resp.payments[0].remote_id : null;
                  render();
                  if (pollInterval) clearInterval(pollInterval);
                  return;
                }
                if (resp.payments && resp.payments.length > 0) {
                  var last = resp.payments[resp.payments.length - 1];
                  if (last.state === 'completed') {
                    state.status = 'confirmed';
                    state.txHash = last.remote_id;
                    render();
                    if (pollInterval) clearInterval(pollInterval);
                  }
                }
              }
            });
          }, 3000);
        }

        function startTimer() {
          if (timerInterval) clearInterval(timerInterval);
          if (!state.payment || !state.payment.expiresAt) return;

          var expires = new Date(state.payment.expiresAt).getTime();

          timerInterval = setInterval(function () {
            var remaining = expires - Date.now();
            if (remaining <= 0) {
              state.timer = 'Expired';
              state.status = 'expired';
              if (cancelOnExpire) state.canceled = true;
              render();
              if (timerInterval) clearInterval(timerInterval);
              return;
            }
            var min = Math.floor(remaining / 60000);
            var sec = Math.floor((remaining % 60000) / 1000);
            state.timer = min + ':' + sec.toString().padStart(2, '0');
            render();
          }, 1000);
        }

        render();
      });
    }
  };

})(jQuery, Drupal, drupalSettings, once);
