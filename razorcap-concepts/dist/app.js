import { estimateCost } from './pricing.js';
const examples = {
  curl: `curl -X POST https://api.razorcap.cc/tasks/create_task \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "key": "YOUR_API_KEY",\n    "type": "hcaptcha",\n    "data": {\n      "sitekey": "SITE_KEY",\n      "siteurl": "https://your-site.example",\n      "proxy": "http://user:pass@host:port"\n    }\n  }'`,
  javascript: `const response = await fetch(\n  "https://api.razorcap.cc/tasks/create_task", {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify({\n      key: "YOUR_API_KEY", type: "hcaptcha",\n      data: { sitekey: "SITE_KEY",\n        siteurl: "https://your-site.example",\n        proxy: "http://user:pass@host:port" }\n    })\n  });`,
  python: `import requests\n\nresponse = requests.post(\n  "https://api.razorcap.cc/tasks/create_task",\n  json={\n    "key": "YOUR_API_KEY", "type": "hcaptcha",\n    "data": {\n      "sitekey": "SITE_KEY",\n      "siteurl": "https://your-site.example",\n      "proxy": "http://user:pass@host:port"\n    }\n  })`
};
const code = document.querySelector('#code');
code.textContent = examples.curl;
const copy = document.querySelector('#copy-code');
document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-language]').forEach(tab => {
    const active = tab === button;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  code.textContent = examples[button.dataset.language];
  copy.textContent = 'Copy';
}));
copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(code.textContent); copy.textContent = 'Copied ✓'; }
  catch { copy.textContent = 'Select code to copy'; }
});
const quantity = document.querySelector('#quantity');
const captcha = document.querySelector('#captcha');
function updatePrice() {
  document.querySelector('#quantity-label').textContent = Number(quantity.value).toLocaleString('en-US');
  document.querySelector('#total').textContent = estimateCost(Number(captcha.value), Number(quantity.value)).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
quantity.addEventListener('input', updatePrice);
captcha.addEventListener('change', updatePrice);
updatePrice();
const run = document.querySelector('#run-demo');
const result = document.querySelector('#demo-result');
run.addEventListener('click', () => {
  if (run.disabled) return;
  run.disabled = true;
  result.closest('.terminal').classList.add('running');
  result.textContent = '◌ Simulating request → processing…';
  setTimeout(() => {
    result.textContent = '✓ Demo complete · Example response received. No live request sent.';
    result.closest('.terminal').classList.remove('running');
    run.disabled = false;
  }, 1500);
});
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.command;
  document.querySelectorAll('[data-command]').forEach(item => item.classList.toggle('selected', item === button));
  const target = document.querySelector(action === 'pricing' ? '#pricing' : '#integration');
  target.scrollIntoView();
  if (action === 'request') run.click();
}));
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('js-motion');
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
  }), { threshold: .08 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
}

const motionToggle = document.querySelector('.motion-toggle');
motionToggle.addEventListener('click', () => {
  const paused = document.body.classList.toggle('motion-paused');
  motionToggle.setAttribute('aria-pressed', String(paused));
  motionToggle.textContent = paused ? 'Resume motion' : 'Pause motion';
});
