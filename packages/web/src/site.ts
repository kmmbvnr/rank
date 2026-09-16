import 'spcss/sp.css';
import './site.css';

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy-command]')) {
    const code = button.parentElement!.querySelector('code')!;
    const label = button.querySelector('span')!;
    let reset: ReturnType<typeof setTimeout>;
    button.addEventListener('click', async () => {
        clearTimeout(reset);
        try {
            await navigator.clipboard.writeText(code.textContent!);
            label.textContent = 'Copied';
        } catch {
            const range = document.createRange();
            range.selectNodeContents(code);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            label.textContent = 'Copy manually';
        }
        reset = setTimeout(() => { label.textContent = 'Copy'; }, 2500);
    });
}
