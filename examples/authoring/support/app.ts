/** Owned synthetic UI, embedded so compiled starters need no asset-copy step. */
export const appHtml = `<!doctype html>
<html lang="en"><head><title>Owned authoring example</title></head><body>
<h1>Draft rehearsal</h1>
<form aria-label="Draft editor" hidden>
<label>Title <input name="title" required></label>
<button>Save draft</button>
</form>
<p role="status">Not saved</p>
<ul aria-label="Drafts"></ul>
<script>
// Continuous synthetic telemetry; it must not determine UI readiness.
window.telemetryTimer = setInterval(() => fetch('/telemetry').catch(() => {}), 50);
setTimeout(() => { document.querySelector('form').hidden = false; }, 200);
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault();
  const title = document.querySelector('input').value;
  const item = document.createElement('li');
  item.textContent = title;
  document.querySelector('ul').append(item);
  localStorage.setItem('lastDraft', title);
  document.querySelector('[role="status"]').textContent = 'Saved: ' + title;
});
</script></body></html>
`;
