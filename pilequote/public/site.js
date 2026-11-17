// Small enhancements for the owner dashboard and admin pages.
document.documentElement.classList.add('js');

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const input = document.querySelector(button.getAttribute('data-copy'));
  if (!input) return;
  const done = () => {
    const label = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => {
      button.textContent = label;
    }, 1500);
  };
  const fallback = () => {
    input.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      /* leave the text selected so it can be copied by hand */
    }
  };
  if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, fallback);
  else fallback();
});

for (const select of document.querySelectorAll('select[data-autosubmit]')) {
  select.addEventListener('change', () => {
    if (select.form.requestSubmit) select.form.requestSubmit();
    else select.form.submit();
  });
}
