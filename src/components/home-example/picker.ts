export interface PickerOption {
  value: string;
  label: string;
  detail?: string;
}
interface Picker {
  control: HTMLButtonElement;
  label: string;
  options(): PickerOption[];
  value(): string;
  choose(value: string): void;
}

/** One styled, keyboard-accessible list shared by the two inline code fields. */
export function setupPickers(popup: HTMLElement, pickers: Picker[]): void {
  let current: Picker | undefined;
  let options: PickerOption[] = [];
  let active = 0;
  let search = '';
  let lastTyped = 0;
  const heading = document.createElement('div');
  heading.className = 'example-picker-heading';
  heading.setAttribute('aria-hidden', 'true');
  const list = document.createElement('div');
  list.className = 'example-picker-options';
  popup.replaceChildren(heading, list);

  function reset(): void {
    if (!current) return;
    current.control.setAttribute('aria-expanded', 'false');
    current.control.removeAttribute('aria-activedescendant');
    current = undefined;
    search = '';
  }
  function close(): void {
    if (popup.matches(':popover-open')) popup.hidePopover();
    reset();
  }
  function position(): void {
    if (!current) return;
    const rect = current.control.getBoundingClientRect();
    const gap = 8;
    const margin = 12;
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - margin * 2);
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const placeAbove = below < 180 && above > below;
    const height = Math.max(60, Math.min(330, placeAbove ? above : below));
    popup.style.width = `${width}px`;
    popup.style.maxHeight = `${height}px`;
    popup.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
    popup.style.top = `${placeAbove ? Math.max(margin, rect.top - gap - popup.offsetHeight) : Math.max(margin, rect.bottom + gap)}px`;
  }
  function highlight(index: number, scroll = true): void {
    if (!current || !options.length) return;
    active = (index + options.length) % options.length;
    for (const [i, child] of [...list.children].entries()) {
      (child as HTMLElement).dataset['active'] = String(i === active);
    }
    const option = list.children[active] as HTMLElement;
    current.control.setAttribute('aria-activedescendant', option.id);
    if (scroll) option.scrollIntoView({ block: 'nearest' });
  }
  function open(picker: Picker): void {
    if (current && current !== picker) close();
    current = picker;
    options = picker.options();
    heading.textContent = picker.label;
    popup.setAttribute('aria-label', picker.label);
    list.replaceChildren(...options.map((item, index) => {
      const row = document.createElement('div');
      row.id = `${popup.id}-${index}`;
      row.className = 'example-picker-option';
      row.dataset['index'] = String(index);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(item.value === picker.value()));
      const text = document.createElement('span');
      const label = document.createElement('span');
      label.className = 'example-picker-label';
      label.textContent = item.label;
      text.append(label);
      if (item.detail) {
        const detail = document.createElement('span');
        detail.className = 'example-picker-detail';
        detail.textContent = item.detail;
        text.append(detail);
      }
      const check = document.createElement('span');
      check.className = 'example-picker-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = item.value === picker.value() ? '✓' : '';
      row.append(text, check);
      return row;
    }));
    picker.control.setAttribute('aria-expanded', 'true');
    if (!popup.matches(':popover-open')) popup.showPopover();
    position();
    highlight(Math.max(0, options.findIndex(item => item.value === picker.value())));
  }
  function choose(index: number): void {
    if (!current || !options[index]) return;
    const picker = current;
    const value = options[index]!.value;
    close();
    picker.choose(value);
    picker.control.focus({ preventScroll: true });
  }
  for (const picker of pickers) {
    picker.control.addEventListener('click', () => {
      if (current === picker) close();
      else open(picker);
    });
    picker.control.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (current === picker) { event.preventDefault(); close(); }
        return;
      }
      if (event.key === 'Tab') { close(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const wasOpen = current === picker;
        if (!wasOpen) open(picker);
        if (event.key === 'Home') highlight(0);
        else if (event.key === 'End') highlight(options.length - 1);
        else if (wasOpen) highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (current === picker) choose(active);
        else open(picker);
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (current !== picker) open(picker);
        const now = Date.now();
        search = (now - lastTyped < 700 ? search : '') + event.key.toLowerCase();
        lastTyped = now;
        const index = options.findIndex(item => item.label.toLowerCase().startsWith(search) || item.value.toLowerCase().startsWith(search));
        if (index >= 0) highlight(index);
      }
    });
  }
  list.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') event.preventDefault();
  });
  list.addEventListener('click', event => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (row) choose(Number(row.dataset['index']));
  });
  list.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (row) highlight(Number(row.dataset['index']), false);
  });
  popup.addEventListener('toggle', () => {
    if (!popup.matches(':popover-open')) reset();
  });
  window.addEventListener('resize', () => { if (current) position(); });
  window.addEventListener('scroll', event => {
    if (current && !(event.target instanceof Node && popup.contains(event.target))) close();
  }, true);
}
