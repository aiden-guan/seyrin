const PLANS = {
  pro: { name: 'Pro', price: '$12' },
  team: { name: 'Team', price: '$29' },
};

const checkout = document.getElementById('checkout');

function openCheckout(planId) {
  const plan = PLANS[planId];
  if (!plan) return;
  for (const el of checkout.querySelectorAll('[data-checkout-plan]')) el.textContent = plan.name;
  checkout.querySelector('[data-checkout-price]').textContent = plan.price;
  checkout.hidden = false;
  checkout.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('checkout-email').focus();
}

for (const button of document.querySelectorAll('[data-plan]')) {
  button.addEventListener('click', () => openCheckout(button.dataset.planId));
}

checkout.querySelector('[data-checkout-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = new FormData(event.currentTarget).get('email');
  const error = checkout.querySelector('[data-checkout-error]');
  if (!String(email).includes('@')) {
    error.textContent = 'Please enter your work email.';
    return;
  }
  error.textContent = '';
  event.currentTarget.hidden = true;
  checkout.querySelector('[data-checkout-done]').hidden = false;
});
