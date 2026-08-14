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
          gasFeeUsd: null,
          gasFeeEth: null,
        };

        var LOGOS = {
          USDC: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4bWxuczp4bGluaz0iaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGluayI+PGRlZnM+PGxpbmVhckdyYWRpZW50IHgxPSI1MCUiIHkxPSIwJSIgeDI9IjUwJSIgeTI9IjEwMCUiIGlkPSJjIj48c3RvcCBzdG9wLWNvbG9yPSIjRkZGIiBzdG9wLW9wYWNpdHk9Ii41IiBvZmZzZXQ9IjAlIi8+PHN0b3Agc3RvcC1vcGFjaXR5PSIuNSIgb2Zmc2V0PSIxMDAlIi8+PC9saW5lYXJHcmFkaWVudD48ZmlsdGVyIHg9Ii01LjglIiB5PSItNC4yJSIgd2lkdGg9IjExMS43JSIgaGVpZ2h0PSIxMTEuNyUiIGZpbHRlclVuaXRzPSJvYmplY3RCb3VuZGluZ0JveCIgaWQ9ImEiPjxmZU9mZnNldCBkeT0iLjUiIGluPSJTb3VyY2VBbHBoYSIgcmVzdWx0PSJzaGFkb3dPZmZzZXRPdXRlcjEiLz48ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIuNSIgaW49InNoYWRvd09mZnNldE91dGVyMSIgcmVzdWx0PSJzaGFkb3dCbHVyT3V0ZXIxIi8+PGZlQ29tcG9zaXRlIGluPSJzaGFkb3dCbHVyT3V0ZXIxIiBpbjI9IlNvdXJjZUFscGhhIiBvcGVyYXRvcj0ib3V0IiByZXN1bHQ9InNoYWRvd0JsdXJPdXRlcjEiLz48ZmVDb2xvck1hdHJpeCB2YWx1ZXM9IjAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAuMTk5NDczNTA1IDAiIGluPSJzaGFkb3dCbHVyT3V0ZXIxIi8+PC9maWx0ZXI+PGNpcmNsZSBpZD0iYiIgY3g9IjE2IiBjeT0iMTUiIHI9IjE1Ii8+PC9kZWZzPjxnIGZpbGw9Im5vbmUiIGZpbGwtcnVsZT0iZXZlbm9kZCI+PHVzZSBmaWxsPSIjMDAwIiBmaWx0ZXI9InVybCgjYSkiIHhsaW5rOmhyZWY9IiNiIi8+PHVzZSBmaWxsPSIjM0U3M0M0IiB4bGluazpocmVmPSIjYiIvPjx1c2UgZmlsbD0idXJsKCNjKSIgc3R5bGU9Im1peC1ibGVuZC1tb2RlOnNvZnQtbGlnaHQiIHhsaW5rOmhyZWY9IiNiIi8+PGNpcmNsZSBzdHJva2Utb3BhY2l0eT0iLjA5NyIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbGluZWpvaW49InNxdWFyZSIgY3g9IjE2IiBjeT0iMTUiIHI9IjE0LjUiLz48ZyBmaWxsPSIjRkZGIiBmaWxsLXJ1bGU9Im5vbnplcm8iPjxwYXRoIGQ9Ik0yMC4wMjIgMTcuMTI0YzAtMi4xMjQtMS4yOC0yLjg1Mi0zLjg0LTMuMTU2LTEuODI4LS4yNDMtMi4xOTMtLjcyOC0yLjE5My0xLjU3OCAwLS44NS42MS0xLjM5NiAxLjgyOC0xLjM5NiAxLjA5NyAwIDEuNzA3LjM2NCAyLjAxMSAxLjI3NWEuNDU4LjQ1OCAwIDAwLjQyNy4zMDNoLjk3NWEuNDE2LjQxNiAwIDAwLjQyNy0uNDI1di0uMDZhMy4wNCAzLjA0IDAgMDAtMi43NDMtMi40ODlWOC4xNDJjMC0uMjQzLS4xODMtLjQyNS0uNDg3LS40ODZoLS45MTVjLS4yNDMgMC0uNDI2LjE4Mi0uNDg3LjQ4NnYxLjM5NmMtMS44MjkuMjQyLTIuOTg2IDEuNDU2LTIuOTg2IDIuOTc0IDAgMi4wMDIgMS4yMTggMi43OTEgMy43NzggMy4wOTUgMS43MDcuMzAzIDIuMjU1LjY2OCAyLjI1NSAxLjYzOSAwIC45Ny0uODUzIDEuNjM4LTIuMDExIDEuNjM4LTEuNTg1IDAtMi4xMzMtLjY2Ny0yLjMxNi0xLjU3OC0uMDYtLjI0Mi0uMjQ0LS4zNjQtLjQyNy0uMzY0aC0xLjAzNmEuNDE2LjQxNiAwIDAwLS40MjYuNDI1di4wNmMuMjQzIDEuNTE4IDEuMjE5IDIuNjEgMy4yMyAyLjkxNHYxLjQ1N2MwIC4yNDIuMTgzLjQyNS40ODcuNDg1aC45MTVjLjI0MyAwIC40MjYtLjE4Mi40ODctLjQ4NVYyMC4zNGMxLjgyOS0uMzAzIDMuMDQ3LTEuNTc4IDMuMDQ3LTMuMjE3eiIvPjxwYXRoIGQ9Ik0xMi44OTIgMjMuNDk3Yy00Ljc1NC0xLjctNy4xOTItNi45OC01LjQyNC0xMS42NTMuOTE0LTIuNTUgMi45MjUtNC40OTEgNS40MjQtNS40MDIuMjQ0LS4xMjEuMzY1LS4zMDMuMzY1LS42MDd2LS44NWMwLS4yNDItLjEyMS0uNDI0LS4zNjUtLjQ4NS0uMDYxIDAtLjE4MyAwLS4yNDQuMDZhMTAuODk1IDEwLjg5NSAwIDAwLTcuMTMgMTMuNzE3YzEuMDk2IDMuNCAzLjcxNyA2LjAxIDcuMTMgNy4xMDIuMjQ0LjEyMS40ODggMCAuNTQ4LS4yNDMuMDYxLS4wNi4wNjEtLjEyMi4wNjEtLjI0M3YtLjg1YzAtLjE4Mi0uMTgyLS40MjQtLjM2NS0uNTQ2em02LjQ2LTE4LjkzNmMtLjI0NC0uMTIyLS40ODggMC0uNTQ4LjI0Mi0uMDYxLjA2MS0uMDYxLjEyMi0uMDYxLjI0M3YuODVjMCAuMjQzLjE4Mi40ODUuMzY1LjYwNyA0Ljc1NCAxLjcgNy4xOTIgNi45OCA1LjQyNCAxMS42NTMtLjkxNCAyLjU1LTIuOTI1IDQuNDkxLTUuNDI0IDUuNDAyLS4yNDQuMTIxLS4zNjUuMzAzLS4zNjUuNjA3di44NWMwIC4yNDIuMTIxLjQyNC4zNjUuNDg1LjA2MSAwIC4xODMgMCAuMjQ0LS4wNmExMC44OTUgMTAuODk1IDAgMDA3LjEzLTEzLjcxN2MtMS4wOTYtMy40Ni0zLjc3OC02LjA3LTcuMTMtNy4xNjJ6Ii8+PC9nPjwvZz48L3N2Zz4=',
          USDT: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGRlZnM+PGZpbHRlciBpZD0iYSIgd2lkdGg9IjExMS43JSIgaGVpZ2h0PSIxMTEuNyUiIHg9Ii01LjglIiB5PSItNC4yJSIgZmlsdGVyVW5pdHM9Im9iamVjdEJvdW5kaW5nQm94Ij48ZmVPZmZzZXQgZHk9Ii41IiBpbj0iU291cmNlQWxwaGEiIHJlc3VsdD0ic2hhZG93T2Zmc2V0T3V0ZXIxIi8+PGZlR2F1c3NpYW5CbHVyIGluPSJzaGFkb3dPZmZzZXRPdXRlcjEiIHJlc3VsdD0ic2hhZG93Qmx1ck91dGVyMSIgc3RkRGV2aWF0aW9uPSIuNSIvPjxmZUNvbXBvc2l0ZSBpbj0ic2hhZG93Qmx1ck91dGVyMSIgaW4yPSJTb3VyY2VBbHBoYSIgb3BlcmF0b3I9Im91dCIgcmVzdWx0PSJzaGFkb3dCbHVyT3V0ZXIxIi8+PGZlQ29sb3JNYXRyaXggaW49InNoYWRvd0JsdXJPdXRlcjEiIHZhbHVlcz0iMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMC4xOTk0NzM1MDUgMCIvPjwvZmlsdGVyPjxmaWx0ZXIgaWQ9ImQiIHdpZHRoPSIxMTguMSUiIGhlaWdodD0iMTE5LjclIiB4PSItOS4xJSIgeT0iLTclIiBmaWx0ZXJVbml0cz0ib2JqZWN0Qm91bmRpbmdCb3giPjxmZU9mZnNldCBkeT0iLjUiIGluPSJTb3VyY2VBbHBoYSIgcmVzdWx0PSJzaGFkb3dPZmZzZXRPdXRlcjEiLz48ZmVHYXVzc2lhbkJsdXIgaW49InNoYWRvd09mZnNldE91dGVyMSIgcmVzdWx0PSJzaGFkb3dCbHVyT3V0ZXIxIiBzdGREZXZpYXRpb249Ii41Ii8+PGZlQ29sb3JNYXRyaXggaW49InNoYWRvd0JsdXJPdXRlcjEiIHZhbHVlcz0iMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMC4yMDQyNTcyNDYgMCIvPjwvZmlsdGVyPjxsaW5lYXJHcmFkaWVudCBpZD0iYyIgeDE9IjUwJSIgeDI9IjUwJSIgeTE9IjAlIiB5Mj0iMTAwJSI+PHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI0ZGRiIgc3RvcC1vcGFjaXR5PSIuNSIvPjxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1vcGFjaXR5PSIuNSIvPjwvbGluZWFyR3JhZGllbnQ+PGNpcmNsZSBpZD0iYiIgY3g9IjE2IiBjeT0iMTUiIHI9IjE1Ii8+PHBhdGggaWQ9ImUiIGQ9Ik0xNy45MjIgMTYuMzgzdi0uMDAyYy0uMTEuMDA4LS42NzcuMDQyLTEuOTQyLjA0Mi0xLjAxIDAtMS43MjEtLjAzLTEuOTcxLS4wNDJ2LjAwM2MtMy44ODgtLjE3MS02Ljc5LS44NDgtNi43OS0xLjY1OCAwLS44MDkgMi45MDItMS40ODYgNi43OS0xLjY2djIuNjQ0Yy4yNTQuMDE4Ljk4Mi4wNjEgMS45ODguMDYxIDEuMjA3IDAgMS44MTItLjA1IDEuOTI1LS4wNnYtMi42NDNjMy44OC4xNzMgNi43NzUuODUgNi43NzUgMS42NTggMCAuODEtMi44OTUgMS40ODUtNi43NzUgMS42NTdtMC0zLjU5di0yLjM2Nmg1LjQxNFY2LjgxOUg4LjU5NXYzLjYwOGg1LjQxNHYyLjM2NWMtNC40LjIwMi03LjcwOSAxLjA3NC03LjcwOSAyLjExOCAwIDEuMDQ0IDMuMzA5IDEuOTE1IDcuNzA5IDIuMTE4djcuNTgyaDMuOTEzdi03LjU4NGM0LjM5My0uMjAyIDcuNjk0LTEuMDczIDcuNjk0LTIuMTE2IDAtMS4wNDMtMy4zMDEtMS45MTQtNy42OTQtMi4xMTciLz48L2RlZnM+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIj48dXNlIGZpbGw9IiMwMDAiIGZpbHRlcj0idXJsKCNhKSIgeGxpbms6aHJlZj0iI2IiLz48dXNlIGZpbGw9IiMyNkExN0IiIHhsaW5rOmhyZWY9IiNiIi8+PHVzZSBmaWxsPSJ1cmwoI2MpIiBzdHlsZT0ibWl4LWJsZW5kLW1vZGU6c29mdC1saWdodCIgeGxpbms6aHJlZj0iI2IiLz48Y2lyY2xlIGN4PSIxNiIgY3k9IjE1IiByPSIxNC41IiBzdHJva2U9IiMwMDAiIHN0cm9rZS1vcGFjaXR5PSIuMDk3Ii8+PHVzZSBmaWxsPSIjMDAwIiBmaWx0ZXI9InVybCgjZCkiIHhsaW5rOmhyZWY9IiNlIi8+PHVzZSBmaWxsPSIjRkZGIiB4bGluazpocmVmPSIjZSIvPjwvZz48L3N2Zz4=',
          ethereum: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGRlZnM+PGZpbHRlciBpZD0iYSIgd2lkdGg9IjExMS43JSIgaGVpZ2h0PSIxMTEuNyUiIHg9Ii01LjglIiB5PSItNC4yJSIgZmlsdGVyVW5pdHM9Im9iamVjdEJvdW5kaW5nQm94Ij48ZmVPZmZzZXQgZHk9Ii41IiBpbj0iU291cmNlQWxwaGEiIHJlc3VsdD0ic2hhZG93T2Zmc2V0T3V0ZXIxIi8+PGZlR2F1c3NpYW5CbHVyIGluPSJzaGFkb3dPZmZzZXRPdXRlcjEiIHJlc3VsdD0ic2hhZG93Qmx1ck91dGVyMSIgc3RkRGV2aWF0aW9uPSIuNSIvPjxmZUNvbXBvc2l0ZSBpbj0ic2hhZG93Qmx1ck91dGVyMSIgaW4yPSJTb3VyY2VBbHBoYSIgb3BlcmF0b3I9Im91dCIgcmVzdWx0PSJzaGFkb3dCbHVyT3V0ZXIxIi8+PGZlQ29sb3JNYXRyaXggaW49InNoYWRvd0JsdXJPdXRlcjEiIHZhbHVlcz0iMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMC4xOTk0NzM1MDUgMCIvPjwvZmlsdGVyPjxmaWx0ZXIgaWQ9ImQiIHdpZHRoPSIxMjMuMyUiIGhlaWdodD0iMTE0LjYlIiB4PSItMTEuNyUiIHk9Ii01LjIlIiBmaWx0ZXJVbml0cz0ib2JqZWN0Qm91bmRpbmdCb3giPjxmZU9mZnNldCBkeT0iLjUiIGluPSJTb3VyY2VBbHBoYSIgcmVzdWx0PSJzaGFkb3dPZmZzZXRPdXRlcjEiLz48ZmVHYXVzc2lhbkJsdXIgaW49InNoYWRvd09mZnNldE91dGVyMSIgcmVzdWx0PSJzaGFkb3dCbHVyT3V0ZXIxIiBzdGREZXZpYXRpb249Ii41Ii8+PGZlQ29tcG9zaXRlIGluPSJzaGFkb3dCbHVyT3V0ZXIxIiBpbjI9IlNvdXJjZUFscGhhIiBvcGVyYXRvcj0ib3V0IiByZXN1bHQ9InNoYWRvd0JsdXJPdXRlcjEiLz48ZmVDb2xvck1hdHJpeCBpbj0ic2hhZG93Qmx1ck91dGVyMSIgdmFsdWVzPSIwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwLjIwNDI1NzI0NiAwIi8+PC9maWx0ZXI+PGxpbmVhckdyYWRpZW50IGlkPSJjIiB4MT0iNTAlIiB4Mj0iNTAlIiB5MT0iMCUiIHkyPSIxMDAlIj48c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjRkZGIiBzdG9wLW9wYWNpdHk9Ii41Ii8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLW9wYWNpdHk9Ii41Ii8+PC9saW5lYXJHcmFkaWVudD48Y2lyY2xlIGlkPSJiIiBjeD0iMTYiIGN5PSIxNSIgcj0iMTUiLz48cGF0aCBpZD0iZSIgZD0iTTE2LjQ5OCAyMC45NjhMMjQgMTYuNjE2bC03LjUwMiAxMC4zNzlMOSAxNi42MTVsNy40OTggNC4zNTF6bTAtMTcuOTY4bDcuNDk3IDEyLjIyLTcuNDk3IDQuMzUzTDkgMTUuMjIgMTYuNDk4IDN6Ii8+PC9kZWZzPjxnIGZpbGw9Im5vbmUiIGZpbGwtcnVsZT0iZXZlbm9kZCI+PHVzZSBmaWxsPSIjMDAwIiBmaWx0ZXI9InVybCgjYSkiIHhsaW5rOmhyZWY9IiNiIi8+PHVzZSBmaWxsPSIjNjI3RUVBIiB4bGluazpocmVmPSIjYiIvPjx1c2UgZmlsbD0idXJsKCNjKSIgc3R5bGU9Im1peC1ibGVuZC1tb2RlOnNvZnQtbGlnaHQiIHhsaW5rOmhyZWY9IiNiIi8+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNSIgcj0iMTQuNSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utb3BhY2l0eT0iLjA5NyIvPjxnIGZpbGwtcnVsZT0ibm9uemVybyI+PHVzZSBmaWxsPSIjMDAwIiBmaWx0ZXI9InVybCgjZCkiIHhsaW5rOmhyZWY9IiNlIi8+PHVzZSBmaWxsPSIjRkZGIiBmaWxsLW9wYWNpdHk9IjAiIGZpbGwtcnVsZT0iZXZlbm9kZCIgeGxpbms6aHJlZj0iI2UiLz48L2c+PGcgZmlsbD0iI0ZGRiIgZmlsbC1ydWxlPSJub256ZXJvIj48cGF0aCBmaWxsLW9wYWNpdHk9Ii42MDIiIGQ9Ik0xNi40OTggM3Y4Ljg3bDcuNDk3IDMuMzV6Ii8+PHBhdGggZD0iTTE2LjQ5OCAzTDkgMTUuMjJsNy40OTgtMy4zNXoiLz48cGF0aCBmaWxsLW9wYWNpdHk9Ii42MDIiIGQ9Ik0xNi40OTggMjAuOTY4djYuMDI3TDI0IDE2LjYxNnoiLz48cGF0aCBkPSJNMTYuNDk4IDI2Ljk5NXYtNi4wMjhMOSAxNi42MTZ6Ii8+PHBhdGggZmlsbC1vcGFjaXR5PSIuMiIgZD0iTTE2LjQ5OCAxOS41NzNsNy40OTctNC4zNTMtNy40OTctMy4zNDh6Ii8+PHBhdGggZmlsbC1vcGFjaXR5PSIuNjAyIiBkPSJNOSAxNS4yMmw3LjQ5OCA0LjM1M3YtNy43MDF6Ii8+PC9nPjwvZz48L3N2Zz4=',
          polygon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj48cGF0aCBmaWxsPSJ1cmwoI3BvbHlnb25fX2EpIiBkPSJtMTYuMzY0IDE1LjIxNyA0LjI3LTIuNDM1YS43My43MyAwIDAgMCAuMzY2LS42MjdWNy4yODRhLjcyLjcyIDAgMCAwLS4zNjYtLjYyN2wtNC4yNy0yLjQzNWEuNzQuNzQgMCAwIDAtLjczMiAwbC00LjI3IDIuNDM1YS43Mi43MiAwIDAgMC0uMzY2LjYyN3Y4LjcwNGwtMi45OTQgMS43MDctMi45OTQtMS43MDd2LTMuNDE1bDIuOTk0LTEuNzA3IDEuOTc0IDEuMTI3VjkuNzAybC0xLjYwOC0uOTE4YS43NS43NSAwIDAgMC0uNzMyIDBsLTQuMjcgMi40MzVhLjcyLjcyIDAgMCAwLS4zNjYuNjI3djQuODdjMCAuMjU4LjE0LjQ5OC4zNjYuNjI3bDQuMjcgMi40MzZhLjc1Ljc1IDAgMCAwIC43MzIgMGw0LjI3LTIuNDM2YS43Mi43MiAwIDAgMCAuMzY2LS42MjZWOC4wMTJsLjA1My0uMDMgMi45NC0xLjY3NyAyLjk5NCAxLjcwN3YzLjQxNWwtMi45OTQgMS43MDctMS45NzItMS4xMjR2Mi4yOTFsMS42MDYuOTE2YS43NS43NSAwIDAgMCAuNzMyIDB6Ii8+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJwb2x5Z29uX19hIiB4MT0iMi45NDIiIHgyPSIyMC4xMTkiIHkxPSIxNy4xOTQiIHkyPSI3LjEwMSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIHN0b3AtY29sb3I9IiNBNzI2QzEiLz48c3RvcCBvZmZzZXQ9Ii44OCIgc3RvcC1jb2xvcj0iIzgwM0JERiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzdCM0ZFNCIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjwvc3ZnPg==',
          celo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj48ZyBjbGlwLXBhdGg9InVybCgjY2Vsb19fYSkiPjxwYXRoIGZpbGw9IiNGQ0ZFNTIiIGQ9Ik0yNCAwSDB2MjRoMjR6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTQgNGgxNnY1LjcxNWgtMi43NjVhNS43MTQgNS43MTQgMCAxIDAgMCA0LjU3SDIwVjIwSDR6Ii8+PC9nPjxkZWZzPjxjbGlwUGF0aCBpZD0iY2Vsb19fYSI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTAgMGgyNHYyNEgweiIvPjwvY2xpcFBhdGg+PC9kZWZzPjwvc3ZnPg==',
          arbitrum: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj48cGF0aCBmaWxsPSIjMjEzMTQ3IiBkPSJNNC41MTUgOC40NzF2Ny4wNTZjMCAuNDUuMjQ1Ljg2Ny42NCAxLjA5Mmw2LjIwNSAzLjUyOWExLjMgMS4zIDAgMCAwIDEuMjggMGw2LjIwMy0zLjUzYy4zOTYtLjIyNC42NC0uNjQuNjQtMS4wOVY4LjQ3YzAtLjQ1LS4yNDQtLjg2Ny0uNjQtMS4wOTFMMTIuNjQgMy44NWExLjMgMS4zIDAgMCAwLTEuMjggMEw1LjE1NSA3LjM4YTEuMjUgMS4yNSAwIDAgMC0uNjM5IDEuMDkxIi8+PHBhdGggZmlsbD0iIzEyQUFGRiIgZD0ibTEzLjM1MyAxMy4zNjgtLjg4NSAyLjM5YS4zLjMgMCAwIDAgMCAuMjA1bDEuNTIzIDQuMTEyIDEuNzYtMS4wMDEtMi4xMTMtNS43MDZhLjE1Mi4xNTIgMCAwIDAtLjI4NSAwbTEuNzc0LTQuMDE5YS4xNTIuMTUyIDAgMCAwLS4yODUgMGwtLjg4NSAyLjM5YS4zLjMgMCAwIDAgMCAuMjA1bDIuNDk0IDYuNzMyIDEuNzYxLTEuMDAxeiIvPjxwYXRoIGZpbGw9IiM5RENDRUQiIGQ9Ik0xMS45OTggNC4xMTVhLjMuMyAwIDAgMSAuMTI2LjAzM2w2LjcxNSAzLjgxOGEuMjUuMjUgMCAwIDEgLjEyNi4yMTR2Ny42MzVjMCAuMDg5LS4wNDguMTctLjEyNi4yMTRsLTYuNzE1IDMuODE5YS4yNS4yNSAwIDAgMS0uMTI2LjAzMi4zLjMgMCAwIDEtLjEyNS0uMDMybC02LjcxNS0zLjgxNWEuMjUuMjUgMCAwIDEtLjEyNi0uMjE1VjguMTgyYzAtLjA4OS4wNDgtLjE3LjEyNi0uMjE1bDYuNzE1LTMuODE4YS4yNi4yNiAwIDAgMSAuMTI1LS4wMzRtMC0xLjExNWMtLjIzOCAwLS40NzguMDYtLjY5Mi4xODNMNC41OTMgN0ExLjM2IDEuMzYgMCAwIDAgMy45IDguMTgydjcuNjM1YzAgLjQ4Ny4yNjQuOTM4LjY5MyAxLjE4MWw2LjcxNCAzLjgxOWExLjQxIDEuNDEgMCAwIDAgMS4zODYgMGw2LjcxNC0zLjgxOGExLjM2IDEuMzYgMCAwIDAgLjY5My0xLjE4MlY4LjE4MkExLjM2IDEuMzYgMCAwIDAgMTkuNDA3IDdsLTYuNzE2LTMuODE3QTEuNCAxLjQgMCAwIDAgMTEuOTk4IDMiLz48cGF0aCBmaWxsPSIjMjEzMTQ3IiBkPSJtNy41NTkgMTguNjg1LjYxNy0xLjY2NiAxLjI0NCAxLjAxOC0xLjE2MyAxLjA0NnoiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTEuNDMzIDcuNjM1SDkuNzMxYS4zLjMgMCAwIDAtLjI4NS4xOTdsLTMuNjQ5IDkuODUyIDEuNzYxIDEuMDAxIDQuMDE4LTEwLjg0OWEuMTUuMTUgMCAwIDAtLjE0My0uMm0yLjk3OS0uMDAxaC0xLjcwM2EuMy4zIDAgMCAwLS4yODQuMTk3bC00LjE2NyAxMS4yNSAxLjc2MSAxIDQuNTM1LTEyLjI0NmEuMTUuMTUgMCAwIDAtLjE0Mi0uMiIvPjwvc3ZnPg==',
          stablechain: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBjbGFzcz0id2ViM2ljb25zIj48ZyBjbGlwLXBhdGg9InVybCgjc3RhYmxlX19hKSI+PHBhdGggZmlsbD0idXJsKCNzdGFibGVfX2IpIiBkPSJNMjQgMEgwdjI0aDI0eiIvPjxwYXRoIGZpbGw9IiNFOEZCRjciIGQ9Ik0xMS45OSAxMi43MzRjLjY2LS40IDEuNjAyLS45NTQgMi4zNDItLjk1NCAxLjE4NiAwIDIuMTc2LjgzOSAyLjE3NiAyLjQzMyAwIDIuNTQzLTMuMDIyIDQuODg3LTcuMjk0IDMuODY2YS4wMjMuMDIzIDAgMCAwLS4wMjguMDIxdjEuMzc1cTAgLjAxNi4wMTUuMDIxYTggOCAwIDAgMCAxLjg1Ni40NDljNS4wMDQuNTg4IDkuMzI4LTMuNTg3IDguOTE2LTguNjA5YTcuODUgNy44NSAwIDAgMC0xLjM5MS0zLjg4NGMtLjAwNi0uMDA5LS4wMTctLjAxNC0uMDMxLS4wMDZsLTYuNTU3IDMuNzljLS43NDUuNDI1LTEuNjAyLjk1Ny0yLjM0MS45NTctMS4xODUgMC0yLjE3Ni0uODQtMi4xNzYtMi40MzMgMC0yLjU0MyAzLjAyMy00Ljg4NyA3LjI5NC0zLjg2NmEuMDIyLjAyMiAwIDAgMCAuMDI4LS4wMjJWNC41MmEuMDIuMDIgMCAwIDAtLjAxNC0uMDIxIDggOCAwIDAgMC05LjM4OCAxMi4wMTljLjAwNy4wMS4wMi4wMTIuMDMuMDA3eiIvPjwvZz48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9InN0YWJsZV9fYiIgeDE9IjI0IiB4Mj0iMCIgeTE9IjAiIHkyPSIyNCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPjxzdG9wIHN0b3AtY29sb3I9IiMwMTFGMUUiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwNDQwMzAiLz48L2xpbmVhckdyYWRpZW50PjxjbGlwUGF0aCBpZD0ic3RhYmxlX19hIj48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMCAwaDI0djI0SDB6Ii8+PC9jbGlwUGF0aD48L2RlZnM+PC9zdmc+',
        };

        function logoImg(key, size) {
          var src = LOGOS[key];
          if (!src) return '';
          return '<img src="' + src + '" width="' + size + '" height="' + size + '" alt="' + escapeHtml(key) + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;flex-shrink:0;">';
        }

        var networkInfo = {
          celo: { color: '#35d07f', url: 'https://celo.org/', explorer: 'https://celoscan.io/tx/', nativeSymbol: 'CELO', nativeCoinId: 'celo' },
          stablechain: { color: '#6366f1', url: 'https://www.stable.xyz/', explorer: 'https://stablescan.xyz/tx/', nativeSymbol: 'USDT', nativeCoinId: 'tether' },
          arbitrum: { color: '#28a0f0', url: 'https://arbitrum.io/', explorer: 'https://arbiscan.io/tx/', nativeSymbol: 'ETH', nativeCoinId: 'ethereum' },
          polygon: { color: '#8247e5', url: 'https://polygon.technology/', explorer: 'https://polygonscan.com/tx/', nativeSymbol: 'MATIC', nativeCoinId: 'matic-network' },
          ethereum: { color: '#627EEA', url: 'https://ethereum.org/', explorer: 'https://etherscan.io/tx/', nativeSymbol: 'ETH', nativeCoinId: 'ethereum' },
        };

        function fmtGasUsd(v) {
          if (v === null || v === undefined || isNaN(v)) return '…';
          var s = v.toFixed(3);
          if (s.indexOf('.') !== -1) {
            s = s.replace(/0+$/, '');
            if (s.charAt(s.length - 1) === '.') s = s.slice(0, -1);
          }
          return s;
        }

        if (initialBalance && !isNaN(parseFloat(initialBalance.balance))) {
          state.amountReceived = parseFloat(initialBalance.balance);
        }

        var pollInterval = null;
        var timerInterval = null;
        var gasFeeInterval = null;

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
              html += '<div style="display: flex; align-items: center; gap: 0.75rem;">' + logoImg(token, 28) + '<div style="font-size: 1.125rem; font-weight: 700;">' + escapeHtml(token) + '</div></div>';
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
            filtered.forEach(function (net) {
              var idx = networks.indexOf(net);
              html += '<button type="button" class="stablepay-btn-network" data-network="' + idx + '" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-radius: 8px; border: 1px solid var(--border, #e5e7eb); background: var(--background, #f9fafb); cursor: pointer; color: var(--text, #111); font-size: 0.875rem; text-align: left; width: 100%;">';
              html += '<div style="display: flex; align-items: center; gap: 0.6rem;">' + logoImg(net.network, 24) + '<div><div style="font-weight: 600;">' + escapeHtml(net.name || net.network) + '</div>';
              html += '<div style="font-size: 0.75rem; color: var(--text-secondary, #666); margin-top: 0.25rem;">' + escapeHtml(net.network) + '</div></div></div>';
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
          var netInfo = networkInfo[p.network] || { color: '#6366f1', url: 'https://www.stable.xyz/', explorer: 'https://stablescan.xyz/tx/', nativeSymbol: 'ETH' };
          var netColor = netInfo.color;
          var netUrl = netInfo.url;
          var isExpired = state.status === 'expired';
          var isConfirmed = state.status === 'confirmed';

          var html = '';
          html += '<style>@keyframes spin { to { transform: rotate(360deg); } } .crypto-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--text-muted, #999); border-top-color: var(--primary, #2563eb); border-radius: 50%; animation: spin 0.8s linear infinite; }</style>';

          html += '<h2 style="margin-bottom: 0.5rem; font-size: 1.25rem;">Crypto Payment</h2>';

          if (!isConfirmed && !isExpired) {
            html += '<p style="font-size: 0.875rem; color: var(--text-secondary, #666); margin-bottom: 1.5rem;">Send the exact amount to the address below</p>';

            html += '<div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--background, #f9fafb); border-radius: 8px; margin-bottom: 0.75rem;">';
            html += '<div><div style="font-size: 0.75rem; color: var(--text-muted, #999); margin-bottom: 0.25rem;">Amount</div>';
            html += '<div style="display: flex; align-items: center; gap: 0.5rem;"><div style="font-size: 1.5rem; font-weight: bold;">$' + p.amount.toFixed(2) + ' <span style="font-size: 1rem; color: var(--text-secondary, #666);">' + escapeHtml(p.tokenSymbol) + '</span></div>' + logoImg(p.tokenSymbol, 26) + '</div></div>';
            html += '<div style="text-align: right;"><div style="font-size: 0.75rem; color: var(--text-muted, #999); margin-bottom: 0.25rem;">Network</div>';
            html += '<a href="' + netUrl + '" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 0.25rem 0.6rem; border-radius: 999px; background: ' + netColor + '; color: #fff; font-weight: 700; font-size: 0.75rem; text-transform: capitalize; text-decoration: none;">' + escapeHtml(p.network) + '</a>';
            html += '<div style="font-size: 0.75rem; color: ' + (state.timer === 'Expired' ? '#dc2626' : 'var(--text-secondary, #666)') + '; margin-top: 0.35rem;">' + state.timer + '</div></div></div>';

            var gasDisplay = state.gasFeeUsd !== null ? '' : 'none';
            html += '<div id="stablepay-gas-fee" style="display:' + gasDisplay + '; font-size:0.75rem; color: var(--text-muted, #999); margin: -0.25rem 0 0.75rem;">Network fee ≈ <strong>$' + (state.gasFeeUsd !== null ? fmtGasUsd(state.gasFeeUsd) : '…') + '</strong> <span>(' + (state.gasFeeEth !== null ? state.gasFeeEth : '…') + ' ' + (netInfo.nativeSymbol || 'ETH') + ') — paid separately from your wallet</span></div>';

            var hasPartial = state.amountReceived >= 0.01;
            var statusBg = hasPartial ? '#ca8a04' : '#f0f0f0';
            html += '<div style="padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1.5rem; background: ' + statusBg + '; color: var(--text, #111); border: 1px solid ' + (hasPartial ? '#ca8a04' : '#ccc') + ';">';
            html += '<div style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">';
            if (hasPartial) {
              var fmtReceived = state.amountReceived >= 1 ? state.amountReceived.toFixed(2) : state.amountReceived.toFixed(6);
              var remaining = Math.max(0, p.amount - state.amountReceived);
              html += '<div style="display: flex; align-items: center; gap: 0.5rem;"><span>Received</span> <span style="font-size: 1.125rem;">' + fmtReceived + '</span> / <span>' + p.amount.toFixed(2) + '</span> <span>' + escapeHtml(p.tokenSymbol) + '</span>' + logoImg(p.tokenSymbol, 18) + '</div>';
              html += '<div style="font-size: 0.875rem; font-weight: 600; color: #111827; margin-top: 0.25rem;">Remaining: ' + remaining.toFixed(2) + ' ' + escapeHtml(p.tokenSymbol) + '</div>';
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

            html += '<button type="button" class="stablepay-btn-metamask" style="display: block; width: 100%; padding: 0.75rem; margin-top: 0.75rem; background: #f6851b; color: #fff; border: none; border-radius: 8px; font-size: 0.875rem; font-weight: 600; cursor: pointer;">Pay with MetaMask</button>';
          }

          if (state.status === 'confirmed') {
            var statusBg = '#16a34a';
            html += '<div style="padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; background: ' + statusBg + '; color: #fff;">';
            html += '<div style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">Payment confirmed!</div>';
            if (state.txHash) {
              var explorerUrl = netInfo.explorer + state.txHash;
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
              if (typeof window.ethereum === 'undefined') {
                window.open('https://metamask.io/download/', '_blank');
                return;
              }
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
          startGasPolling();

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

        var lastQrValue = null;

        function generateQR() {
          var qrContainer = document.getElementById('stablepay-qr');
          if (!qrContainer || !state.payment) return;

          var value = state.qrMode === 'eip681'
            ? 'ethereum:' + state.payment.tokenAddress + '@' + state.payment.chainId + '/transfer?address=' + state.payment.receivingAddress + '&uint256=' + (parseInt(state.payment.amount * Math.pow(10, state.payment.decimals || 6)) || 0)
            : state.payment.receivingAddress;

          if (lastQrValue === value && qrContainer.firstChild) {
            return;
          }
          lastQrValue = value;

          if (typeof qrcode !== 'function') {
            qrContainer.innerHTML = '<span style="font-size: 0.75rem; color: var(--text-secondary, #666);">' + escapeHtml(value) + '</span>';
            return;
          }

          var qr = qrcode(0, 'M');
          qr.addData(value);
          qr.make();

          qrContainer.innerHTML = '';
          var img = document.createElement('img');
          img.src = qr.createDataURL(5, 4);
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

        function startGasPolling() {
          if (gasFeeInterval) clearInterval(gasFeeInterval);
          if (!state.payment) return;

          var url = drupalSettings.path && drupalSettings.path.baseUrl ? drupalSettings.path.baseUrl : '/';
          url = url.replace(/\/+$/, '');
          var baseUrl = window.location.origin + url + '/stablepay/payment';

          function fetchFee() {
            var p = state.payment;
            if (!p) return;
            var netInfo = networkInfo[p.network] || {};
            var coin = netInfo.nativeCoinId || 'ethereum';
            var nativeSymbol = netInfo.nativeSymbol || 'ETH';
            var estimateUrl = baseUrl + '/gas-estimate'
              + '?rpc_url=' + encodeURIComponent(p.rpcUrl)
              + '&token_address=' + encodeURIComponent(p.tokenAddress)
              + '&to=' + encodeURIComponent(p.receivingAddress)
              + '&amount=' + encodeURIComponent(p.amount.toFixed(2))
              + '&decimals=' + (p.decimals || 6);
            var priceUrl = baseUrl + '/gas-price?coin=' + encodeURIComponent(coin);

            $.when(
              $.ajax({ url: estimateUrl, method: 'GET', dataType: 'json' }),
              $.ajax({ url: priceUrl, method: 'GET', dataType: 'json' })
            ).done(function (estResp, priceResp) {
              var est = Array.isArray(estResp) ? estResp[0] : estResp;
              var price = Array.isArray(priceResp) ? priceResp[0] : priceResp;
              var costNative = parseFloat(est && est.cost_native);
              var usd = parseFloat(price && price.usd);
              if (isNaN(costNative) || costNative <= 0 || isNaN(usd) || usd <= 0) {
                state.gasFeeUsd = null;
                state.gasFeeEth = null;
              } else {
                state.gasFeeUsd = costNative * usd;
                state.gasFeeEth = costNative < 0.000001 ? costNative.toFixed(8) : costNative.toFixed(6);
              }
              var el = document.getElementById('stablepay-gas-fee');
              if (el) {
                el.style.display = (state.gasFeeUsd !== null) ? '' : 'none';
                if (state.gasFeeUsd !== null) {
                  el.innerHTML = 'Network fee ≈ <strong>$' + fmtGasUsd(state.gasFeeUsd) + '</strong> <span>(' + state.gasFeeEth + ' ' + nativeSymbol + ') — paid separately from your wallet</span>';
                }
              }
            }).fail(function () {
              state.gasFeeUsd = null;
              state.gasFeeEth = null;
              var el = document.getElementById('stablepay-gas-fee');
              if (el) el.style.display = 'none';
            });
          }

          fetchFee();
          gasFeeInterval = setInterval(fetchFee, 30000);
        }

        render();
      });
    }
  };

})(jQuery, Drupal, drupalSettings, once);
