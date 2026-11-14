import './style.css';
import './hangar.css';
import { App } from './ui/app';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#fff;background:#04060d;height:100vh">Mission Architect needs WebGL. Please try a recent version of Chrome, Edge, Firefox or Safari.</div>';
} else {
  const app = new App();
  (window as unknown as { missionArchitect: App }).missionArchitect = app;
}
