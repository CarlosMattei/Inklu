import { Node } from '@tiptap/core';
import DOMPurify from 'dompurify';

/** Identificação e assinaturas vêm do modelo e do perfil e ficam em modo leitura. */
export const PlanFixed = Node.create({
  name: 'planFixed', group: 'block', atom: true, selectable: false, draggable: false,
  addAttributes() {
    return {
      role: { default: 'header', parseHTML: element => element.getAttribute('data-plan-fixed') },
      html: { default: '', parseHTML: element => DOMPurify.sanitize(element.innerHTML) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-plan-fixed]' }]; },
  renderHTML({ node }) {
    const element = document.createElement('div');
    element.setAttribute('data-plan-fixed', String(node.attrs['role']));
    element.setAttribute('contenteditable', 'false');
    element.innerHTML = DOMPurify.sanitize(String(node.attrs['html']));
    return element;
  },
});

/** Cada pergunta existe uma vez; apenas sua resposta é editável. */
export const PlanField = Node.create({
  name: 'planField', group: 'block', content: 'block+', defining: true, isolating: true,
  addAttributes() {
    return {
      fieldId: { default: '', parseHTML: element => element.getAttribute('data-plan-field') },
      label: { default: '', parseHTML: element => element.querySelector('h3')?.textContent ?? '' },
      hint: { default: '', parseHTML: element => DOMPurify.sanitize(element.querySelector('[data-plan-hint]')?.innerHTML ?? '') },
    };
  },
  parseHTML() { return [{ tag: 'div[data-plan-field]', contentElement: '[data-plan-content]' }]; },
  renderHTML({ node }) {
    const hint = document.createElement('div');
    hint.setAttribute('data-plan-hint', 'true'); hint.setAttribute('contenteditable', 'false');
    hint.innerHTML = DOMPurify.sanitize(String(node.attrs['hint']));
    return ['div', { 'data-plan-field': node.attrs['fieldId'] },
      ['h3', { contenteditable: 'false' }, String(node.attrs['label'])],
      ...(node.attrs['hint'] ? [hint] : []),
      ['div', { 'data-plan-content': 'true' }, 0],
    ];
  },
});
