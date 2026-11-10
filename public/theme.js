/* Motyw wspólny dla rezerwacji, administratora i właścicieli. */
(function () {
  const key = 'date-booking-theme';
  const options = ['auto', 'light', 'dark'];
  function stored() { try { const value = localStorage.getItem(key); return options.includes(value) ? value : 'auto'; } catch { return 'auto'; } }
  function apply(mode) {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode === 'auto' ? 'light dark' : mode;
    const dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.content = dark ? '#17171d' : (location.pathname.startsWith('/admin') ? '#19283b' : '#f7f5f2'));
    const select = document.getElementById('themeSelect');
    if (select) select.value = mode;
  }
  apply(stored());
  document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.topbar');
    if (!header || document.getElementById('themeSelect')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'header-actions';
    const existing = header.querySelector('.admin-link');
    if (existing) wrapper.appendChild(existing);
    const label = document.createElement('label');
    label.className = 'theme-label';
    label.setAttribute('for', 'themeSelect');
    label.textContent = 'Motyw';
    const select = document.createElement('select');
    select.id = 'themeSelect';
    select.className = 'theme-select';
    select.setAttribute('aria-label', 'Wybierz motyw strony');
    [['auto','⚙ Automatyczny'], ['light','☀ Jasny'], ['dark','☾ Ciemny']].forEach(([value, text]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option);
    });
    select.addEventListener('change', () => { try { localStorage.setItem(key, select.value); } catch {} apply(select.value); });
    label.appendChild(select); wrapper.appendChild(label); header.appendChild(wrapper);
    apply(stored());
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (stored() === 'auto') apply('auto'); });
})();
