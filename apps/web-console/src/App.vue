<template>
  <el-container class="app-container" v-if="wsStore.isAuthenticated">
    <el-header class="app-header">
      <div class="header-left">
        <h1>Electron Agent Console</h1>
        <el-menu :default-active="activeMenu" mode="horizontal" :ellipsis="false" router class="nav-menu">
          <el-menu-item index="/devices">设备列表</el-menu-item>
          <el-menu-item index="/audit">审计日志</el-menu-item>
        </el-menu>
      </div>
      <div class="header-right">
        <el-tag v-if="wsStore.connected" type="success">已连接</el-tag>
        <el-tag v-else type="warning">未连接</el-tag>
        <el-button size="small" link @click="handleLogout">退出登录</el-button>
      </div>
    </el-header>

    <el-main class="app-main">
      <router-view />
    </el-main>
  </el-container>

  <!-- When not authenticated, just render the route (Login view). -->
  <router-view v-else />
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWebSocketStore } from '@/stores/websocket';

const wsStore = useWebSocketStore();
const route = useRoute();
const router = useRouter();

const wsConnected = computed(() => wsStore.connected);
const activeMenu = computed(() => {
  // Highlight the devices item for any device-scoped route too.
  if (route.path.startsWith('/devices') || /^\/(monitor|control|cookies|storage|dom|network|console|errors)\b/.test(route.path)) {
    return '/devices';
  }
  if (route.path.startsWith('/audit')) return '/audit';
  return route.path;
});
void wsConnected;

onMounted(() => {
  // P2 CONFIG CLEANUP: only open the WebSocket when a JWT is present.
  if (wsStore.isAuthenticated) {
    wsStore.connect();
  }
});

// Connect as soon as login succeeds (jwt becomes non-null after Login view).
watch(
  () => wsStore.isAuthenticated,
  (authed) => {
    if (authed) {
      wsStore.connect();
    } else if (route.path !== '/login') {
      router.push('/login');
    }
  }
);

const handleLogout = () => {
  wsStore.logout();
  router.push('/login');
};
</script>

<style scoped>
.app-container {
  height: 100vh;
  background: #f5f5f5;
}

.app-header {
  background: white;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.header-left h1 {
  font-size: 18px;
  margin: 0;
  font-weight: 600;
  color: #333;
  white-space: nowrap;
}

.nav-menu {
  border-bottom: none;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-main {
  padding: 24px;
  overflow: auto;
}
</style>
