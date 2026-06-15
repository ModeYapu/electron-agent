<template>
  <div class="screenshot-clicker">
    <div class="screenshot-container" @click="handleClick" @contextmenu.prevent="handleContextMenu">
      <img
        :src="screenshotData"
        class="screenshot-image"
        :style="{ cursor: isHovering ? 'crosshair' : 'default' }"
        @mouseenter="isHovering = true"
        @mouseleave="isHovering = false"
        @mousemove="handleMouseMove"
      />
      <div
        v-if="isHovering && showTooltip"
        class="coordinate-tooltip"
        :style="{ left: tooltipX + 'px', top: tooltipY + 'px' }"
      >
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
}

interface Emits {
  (event: 'click', data: { x: number; y: number; button: 'left' | 'right' }): void;
  (event: 'contextMenu', data: { x: number; y: number }): void;
}

const props = withDefaults(defineProps<Props>(), {
  screenshotData: '',
  deviceId: '',
});

const emit = defineEmits<Emits>();

const isHovering = ref(false);
const mouseX = ref(0);
const mouseY = ref(0);
const tooltipX = ref(0);
const tooltipY = ref(0);
const showTooltip = ref(true);

const handleMouseMove = (event: MouseEvent) => {
  const rect = (event.target as HTMLImageElement).getBoundingClientRect();
  mouseX.value = Math.round(event.clientX - rect.left);
  mouseY.value = Math.round(event.clientY - rect.top);

  // Position tooltip near cursor but ensure it stays within bounds
  tooltipX.value = Math.min(event.clientX - rect.left + 15, rect.width - 100);
  tooltipY.value = Math.min(event.clientY - rect.top + 15, rect.height - 30);
};

const handleClick = (event: MouseEvent) => {
  const rect = (event.target as HTMLImageElement).getBoundingClientRect();
  const x = Math.round(event.clientX - rect.left);
  const y = Math.round(event.clientY - rect.top);

  emit('click', { x, y, button: event.button === 2 ? 'right' : 'left' });
};

const handleContextMenu = (event: MouseEvent) => {
  const rect = (event.target as HTMLImageElement).getBoundingClientRect();
  const x = Math.round(event.clientX - rect.left);
  const y = Math.round(event.clientY - rect.top);

  emit('contextMenu', { x, y });
};
</script>

<style scoped>
.screenshot-clicker {
  width: 100%;
  height: 100%;
  position: relative;
}

.screenshot-container {
  position: relative;
  display: inline-block;
  width: 100%;
  height: 100%;
}

.screenshot-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.coordinate-tooltip {
  position: absolute;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
  pointer-events: none;
  z-index: 1000;
  white-space: nowrap;
}
</style>