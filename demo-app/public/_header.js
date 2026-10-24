// Shared header so every page has the same navigation.
const here = location.pathname.replace(/\.html$/, '') || '/';
const links = [['/', 'Home'], ['/pricing', 'Pricing'], ['/signup', 'Sign up']];
document.body.insertAdjacentHTML('afterbegin', `<header><a class="brand" href="/"><span class="brand-mark">P</span>Perch</a><nav aria-label="Main">${links
  .map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a>`)
  .join('')}</nav></header>`);
document.body.insertAdjacentHTML('beforeend', '<footer>Perch is a fictional product for the Seyrin × Kane CLI demo.</footer>');
