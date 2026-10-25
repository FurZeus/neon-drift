import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/chakra-petch/700-italic.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import { Game } from './core/Game';

const container = document.getElementById('game');
if (!container) throw new Error('#game bulunamadı');

const game = new Game(container);
game.init().catch((err) => {
  console.error(err);
  const el = document.getElementById('error-text');
  if (el) el.textContent = 'Beklenmeyen bir hata oluştu. Sayfayı yenileyip tekrar deneyin.';
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active'));
  document.getElementById('screen-error')?.classList.add('is-active');
});
