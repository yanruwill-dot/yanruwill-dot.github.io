const items = document.querySelectorAll('.method-item');
const word = document.querySelector('#word');
items.forEach(item => item.addEventListener('click', () => {
  items.forEach(other => other.classList.remove('active'));
  item.classList.add('active');
  word.textContent = item.dataset.word;
}));
const observer = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) entry.target.classList.add('in-view');
}), { threshold: .12 });
document.querySelectorAll('section, .service-grid article, .field-grid figure').forEach(el => observer.observe(el));
