// OpenMontage Studio - 侧边栏工作台 widget 前端
// 零依赖：手写 hana.plugin.ui 协议（对齐 @hana/plugin-sdk），发送 ready 握手，
// 点击工件文件时调用宿主 resource.open 能力直接打开预览。
(function () {
  'use strict';

  var HOST_PROTOCOL = 'hana.plugin.ui';
  var HOST_VERSION = 1;
  var hostOrigin = '*';
  (function resolveHostOrigin() {
    try {
      var q = new URLSearchParams(window.location.search);
      var ho = q.get('hana-host-origin');
      if (ho) { hostOrigin = ho; return; }
      if (document.referrer) {
        hostOrigin = new URL(document.referrer).origin;
      }
    } catch (e) { /* 保持 * */ }
  })();

  function post(type, payload) {
    var msg = { protocol: HOST_PROTOCOL, version: HOST_VERSION, kind: 'event', type: type };
    if (payload !== undefined) msg.payload = payload;
    window.parent.postMessage(msg, hostOrigin);
  }

  function request(type, payload) {
    return new Promise(function (resolve, reject) {
      var id = 'w' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
      var timer = null;
      function onMsg(e) {
        if (e.source !== window.parent) return;
        if (hostOrigin !== '*' && e.origin !== hostOrigin) return;
        var d = e.data;
        if (!d || d.protocol !== HOST_PROTOCOL || d.id !== id) return;
        window.removeEventListener('message', onMsg);
        if (timer) clearTimeout(timer);
        if (d.kind === 'response') resolve(d.payload);
        else if (d.kind === 'error') reject(new Error((d.error && d.error.message) || 'host error'));
      }
      window.addEventListener('message', onMsg);
      timer = setTimeout(function () {
        window.removeEventListener('message', onMsg);
        reject(new Error('host timeout'));
      }, 10000);
      var msg = { protocol: HOST_PROTOCOL, version: HOST_VERSION, id: id, kind: 'request', type: type };
      if (payload !== undefined) msg.payload = payload;
      try {
        window.parent.postMessage(msg, hostOrigin);
      } catch (e) {
        window.removeEventListener('message', onMsg);
        if (timer) clearTimeout(timer);
        reject(e);
      }
    });
  }

  function openFile(path) {
    request('resource.open', { resource: { kind: 'local-file', path: path }, mode: 'preview' })
      .catch(function () { /* 宿主未授权或打开失败时静默 */ });
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-open]') : null;
    if (el) openFile(el.getAttribute('data-open'));
  });

  // widget iframe 握手：告知宿主已就绪
  post('hana.ready');
})();