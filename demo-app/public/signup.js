const form = document.querySelector('[data-signup-form]');
const error = document.querySelector('[data-signup-error]');

// Letters, digits, dots and dashes before the @.
const EMAIL = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const name = String(data.get('name') || '').trim();
  const email = String(data.get('email') || '').trim();
  const studio = String(data.get('studio') || '').trim();
  if (!name || !studio) {
    error.textContent = 'Please fill in every field.';
    return;
  }
  if (!EMAIL.test(email)) {
    error.textContent = 'Please enter a valid email address.';
    return;
  }
  error.textContent = '';
  document.querySelector('[data-signup-name]').textContent = name.split(/\s+/)[0];
  document.querySelector('[data-signup-email]').textContent = email;
  document.querySelector('[data-signup-studio]').textContent = studio;
  document.querySelector('[data-signup]').hidden = true;
  document.querySelector('[data-signup-done]').hidden = false;
});
