// Aplica o tema antes da primeira pintura (evita "piscar" ao abrir no modo escuro).
(function () {
  try {
    var t = localStorage.getItem('asa-theme');
    var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
