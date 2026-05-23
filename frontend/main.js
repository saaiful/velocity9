import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './style.css';

import Alpine from 'alpinejs';
import { createIcons, icons } from 'lucide';
import velocity9App from './app.js';

window.lucide = {
  createIcons: () => createIcons({ icons }),
};

Alpine.data('velocity9App', velocity9App);
window.Alpine = Alpine;
Alpine.start();
