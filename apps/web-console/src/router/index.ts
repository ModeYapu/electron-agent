import { createRouter, createWebHistory } from 'vue-router';
import Login from '@/views/Login.vue';
import DeviceList from '@/views/DeviceList.vue';
import LiveMonitor from '@/views/LiveMonitor.vue';
import RemoteControl from '@/views/RemoteControl.vue';
import CookieManager from '@/views/CookieManager.vue';
import StorageManager from '@/views/StorageManager.vue';
import DOMInspector from '@/views/DOMInspector.vue';
import NetworkMonitor from '@/views/NetworkMonitor.vue';
import ConsoleMonitor from '@/views/ConsoleMonitor.vue';
import ErrorMonitor from '@/views/ErrorMonitor.vue';
import AuditLog from '@/views/AuditLog.vue';
import { getStoredJwt } from '@/stores/websocket';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login, meta: { public: true } },

    { path: '/', redirect: '/devices' },
    { path: '/devices', component: DeviceList },

    // Device-scoped views. `props: true` passes :deviceId into the component.
    { path: '/monitor/:deviceId?', component: LiveMonitor, props: true },
    { path: '/control/:deviceId?', component: RemoteControl, props: true },
    { path: '/cookies/:deviceId?', component: CookieManager, props: true },
    { path: '/storage/:deviceId?', component: StorageManager, props: true },
    { path: '/dom/:deviceId?', component: DOMInspector, props: true },
    { path: '/network/:deviceId?', component: NetworkMonitor, props: true },
    { path: '/console/:deviceId?', component: ConsoleMonitor, props: true },
    { path: '/errors/:deviceId?', component: ErrorMonitor, props: true },

    // Global views (no device scope).
    { path: '/audit', component: AuditLog },
  ],
});

// P2 CONFIG CLEANUP: gate every non-public route behind a stored JWT.
router.beforeEach((to) => {
  const hasJwt = getStoredJwt() !== null;
  if (to.meta.public) {
    // Already authenticated? Don't show the login page again.
    if (hasJwt && to.path === '/login') {
      return '/devices';
    }
    return true;
  }
  if (!hasJwt) {
    return '/login';
  }
  return true;
});

export default router;
