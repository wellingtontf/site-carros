// Ajudas de tela compartilhadas pelos temas (o motor não toca em tela).
window.UI = (() => {
  // Se a foto não carregar (ainda não subiu pro S3, por ex.), mostra um placeholder.
  function fallback(img) {
    const label = img.dataset.fb || '';
    const f = () => { img.onerror = null; img.removeAttribute('srcset'); img.src = Motor.util.placeholder(label); };
    img.onerror = f;
    if (img.getAttribute('src') && img.complete && img.naturalWidth === 0) f();
  }
  async function copiar(texto, btn) {
    try { await navigator.clipboard.writeText(texto); } catch (e) { window.prompt('Copie o link:', texto); }
    if (btn) { const t = btn.textContent; btn.textContent = 'Copiado!'; setTimeout(() => (btn.textContent = t), 1500); }
  }
  return { fallback, copiar };
})();
