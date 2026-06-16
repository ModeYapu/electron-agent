<template>
  <div class="screenshot-clicker">
    <div class="screenshot-container" @click="handleClick" @contextmenu.prevent="handleContextMenu">
      <img
        :src="screenshotData"
        class="screenshot-image"
        :style="{ cursor: cursorStyle }"
        @mouseenter="isHovering = true"
        @mouseleave="isHovering = false"
        @mousemove="handleMouseMove"
      />
      <div
        v-if="isHovering && showTooltip"
        class="coordinate-tooltip"
        :class="modeClass"
        :style="{ left: tooltipX + 'px', top: tooltipY + 'px' }"
      >
        <span class="mode-icon">{{ modeIcon }}</span>
        X: {{ mouseX }}, Y: {{ mouseY }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface Props {
  screenshotData?: string;
  deviceId?: string;
  actionMode?: 'click' | 'type' | 'select';
  viewportWidth?: number;
  viewportHeight?: number;
}

interface Emits {
  (event: 'click', data: { x: number; y: number; button: 'left' | 'right' }): void;
  (event: 'contextMenu', data: { x: number; y: number }): void;
}

const props = withDefaults(defineProps<Props>(), {
  screenshotData: '',
  deviceId: '',
  actionMode: 'click',
  viewportWidth: 0,
  viewportHeight: 0,
});

const emit = defineEmits<Emits>();

const isHovering = ref(false);
const mouseX = ref(0);
const mouseY = ref(0);
const tooltipX = ref(0);
const tooltipY = ref(0);
const showTooltip = ref(true);

const cursorStyle = computed(() => {
  switch (props.actionMode) {
    case 'type': return 'text';
    case 'select': return 'pointer';
    default: return isHovering.value ? 'crosshair' : 'default';
  }
});

const modeIcon = computed(() => {
  switch (props.actionMode) {
    case 'type': return '⌨';
    case 'select': return '📋';
    default: return '🖱';
  }
});

const modeClass = computed(() => `mode-${props.actionMode}`);

const handleMouseMove = (event: MouseEvent) => {
  const img = event.target as HTMLImageElement;
  const rect = img.getBoundingClientRect();
  const vpW = props.viewportWidth || img.naturalWidth;
  const vpH = props.viewportHeight || img.naturalHeight;
  if (!vpW || !vpH) return;
  const scaleX = vpW / rect.width;
  const scaleY = vpH / rect.height;
  mouseX.value = Math.round((event.clientX - rect.left) * scaleX);
  mouseY.value = Math.round((event.clientY - rect.top) * scaleY);
  tooltipX.value = Math.min(event.clientX - rect.left + 15, rect.width - 120);
  tooltipY.value = Math.min(event.clientY - rect.top + 15, rect.height - 30);
};

const handleClick = (event: MouseEvent) => {
  const img = event.target as HTMLImageElement;
  const rect = img.getBoundingClientRect();
  const vpW = props.viewportWidth || img.naturalWidth;
  const vpH = props.viewportHeight || img.naturalHeight;
  if (!vpW || !vpH) return;
  const scaleX = vpW / rect.width;
  const scaleY = vpH / rect.height;
  const x = Math.round((event.clientX - rect.left) * scaleX);
  const y = Math.round((event.clientY - rect.top) * scaleY);
  emit('click', { x, y, button: event.button === 2 ? 'right' : 'left' });
};

const handleContextMenu = (event: MouseEvent) => {
  const img = event.target as HTMLImageElement;
  const rect = img.getBoundingClientRect();
  const vpW = props.viewportWidth || img.naturalWidth;
  const vpH = props.viewportHeight || img.naturalHeight;
  if (!vpW || !vpH) return;
  const scaleX = vpW / rect.width;
  const scaleY = vpH / rect.height;
  const x = Math.round((event.clientX - rect.left) * scaleX);
  const y = Math.round((event.clientY - rect.top) * scaleY);
  emit('contextMenu', { x, y });
};
</script>

<style scoped>
.screenshot-clicker { width: 100%; height: 100%; position: relative; }
.screenshot-container { position: relative; display: inline-block; width: 100%; height: 100%; }
.screenshot-image { width: 100%; height: 100%; object-fit: contain; display: block; }

.coordinate-tooltip {
  position: absolute;
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
  pointer-events: none;
  z-index: 1000;
  white-space: nowrap;
}
.mode-icon { margin-right: 4px; }
.mode-type { background: rgba(24, 144, 255, 0.9); }
.mode-select { background: rgba(82, 196, 26, 0.9); }
</style>
