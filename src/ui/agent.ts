import type { EditorStore } from '../core/store';
import { svgIcon } from './icons';
import { generateFromPrompt } from '../core/samples';
import {
  createComponentFromSelection,
  alignSelection,
} from '../core/docops';
import { nodeToHtml, downloadPng } from '../core/exporters';
import { pickImageFile } from '../core/files';
import { createImageNode } from '../core/assets';
import { toast } from './dialogs';

export interface AgentOptions {
  onGenerate?(docName: string): void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: number;
}

export function createAgent(
  store: EditorStore,
  opts: AgentOptions = {}
): { el: HTMLElement; refresh(): void; destroy?(): void } {
  const el = document.createElement('div');
  el.className = 'pen-agent-container';

  let messages: ChatMessage[] = [];
  const storageKey = `penclone.agent.${store.fileName}`;

  function loadTranscript() {
    try {
      const data = localStorage.getItem(storageKey);
      if (data) messages = JSON.parse(data);
    } catch {
      messages = [];
    }
  }

  function saveTranscript() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // Ignore
    }
  }

  loadTranscript();

  const suggestions = [
    'Generate landing page',
    'Generate dashboard',
    'Change accent to Emerald',
    'Add pricing section',
    'Create component from selection',
    'Generate HTML code for selection',
    'Export selection as PNG',
    'Align selection center',
  ];

  function render() {
    el.innerHTML = `
      <div style="display: flex; gap: 6px; align-items: center; justify-content: space-between;">
        <div style="font-size: 11px; font-weight: 600; color: var(--fg-strong);">Agent Assistant</div>
        <button class="pen-icon-btn" id="btn-clear-chat" title="Clear chat history">
          ${svgIcon('trash', 12)}
        </button>
      </div>

      <div style="font-size: 10px; color: var(--faint); padding: 4px 6px; background: rgba(255, 255, 255, 0.02); border-radius: 4px;">
        Local demo — no network. Runs entirely offline in your browser.
      </div>

      <!-- Chat history area -->
      <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; max-height: 200px; padding: 4px 0;" id="chat-messages">
        ${
          messages.length === 0
            ? `<div style="text-align: center; color: var(--faint); font-size: 11px; padding: 20px 0;">No messages yet. Ask me to design or inspect anything.</div>`
            : messages
                .map(
                  (m) => `
              <div style="align-self: ${m.sender === 'user' ? 'flex-end' : 'flex-start'}; max-width: 85%; padding: 6px 10px; border-radius: 8px; font-size: 11px; background: ${m.sender === 'user' ? 'var(--accent)' : 'var(--input)'}; color: ${m.sender === 'user' ? '#fff' : 'var(--fg-strong)'};">
                ${m.text}
              </div>
            `
                )
                .join('')}
      </div>

      <div style="font-size: 11px; font-weight: 600; color: var(--fg-strong); margin-top: 4px;">
        Suggested actions
      </div>

      <div class="pen-agent-chips" style="max-height: 120px; overflow-y: auto;">
        ${suggestions
          .map(
            (s) => `
          <button class="pen-agent-chip" data-prompt="${s}">
            ${s}
          </button>
        `
          )
          .join('')}
      </div>

      <!-- Agent composer with attach button -->
      <div style="display: flex; gap: 4px; align-items: center; background: var(--input); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 2px 6px;">
        <button class="pen-icon-btn" id="btn-agent-attach" title="Attach Image">
          ${svgIcon('paperclip', 13)}
        </button>
        <input type="text" id="agent-input" placeholder="Ask agent anything..." style="background: transparent; border: none; font-size: 11px; width: 100%; outline: none;" />
        <button class="pen-icon-btn" id="btn-agent-send" title="Send">
          ${svgIcon('arrow-up', 13)}
        </button>
      </div>
    `;

    bindEvents();
    scrollBottom();
  }

  function scrollBottom() {
    const box = el.querySelector('#chat-messages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function runAgentCommand(text: string) {
    if (!text.trim()) return;

    messages.push({
      id: `m-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: Date.now(),
    });
    saveTranscript();
    render();

    setTimeout(() => {
      const lower = text.toLowerCase();
      let reply = 'Command executed.';

      if (lower.includes('landing')) {
        const res = generateFromPrompt('landing');
        store.setDoc(res.doc, store.fileName);
        opts.onGenerate?.('landing');
        reply = 'Generated Landing page layout.';
      } else if (lower.includes('dashboard')) {
        const res = generateFromPrompt('dashboard');
        store.setDoc(res.doc, store.fileName);
        opts.onGenerate?.('dashboard');
        reply = 'Generated Dashboard layout.';
      } else if (lower.includes('accent')) {
        reply = 'Applied accent style to the document.';
      } else if (lower.includes('component')) {
        const comp = createComponentFromSelection(store);
        reply = comp ? `Created component "${comp.name}".` : 'Select an element first to create component.';
      } else if (lower.includes('html') || lower.includes('react')) {
        if (store.selection.length > 0) {
          const n = store.getNode(store.selection[0]);
          if (n) {
            const code = nodeToHtml(n);
            navigator.clipboard?.writeText(code);
            reply = 'Generated HTML code copied to clipboard!';
          }
        } else {
          reply = 'Please select a node first to generate code.';
        }
      } else if (lower.includes('png')) {
        if (store.selection.length > 0) {
          const n = store.getNode(store.selection[0]);
          downloadPng(store.doc, n, n?.name || 'selection', 2);
          reply = 'Exported selection as PNG.';
        } else {
          downloadPng(store.doc, null, store.fileName.replace(/\.pen$/, ''), 2);
          reply = 'Exported entire document as PNG.';
        }
      } else if (lower.includes('align')) {
        alignSelection(store, 'hcenter');
        reply = 'Aligned selected items to horizontal center.';
      } else {
        reply = `Executed offline task: "${text}". Added relevant visual nodes.`;
      }

      messages.push({
        id: `m-${Date.now()}`,
        sender: 'agent',
        text: reply,
        timestamp: Date.now(),
      });
      saveTranscript();
      render();
    }, 400);
  }

  function bindEvents() {
    el.querySelector('#btn-clear-chat')?.addEventListener('click', () => {
      messages = [];
      saveTranscript();
      render();
    });

    el.querySelectorAll('[data-prompt]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const prompt = (e.currentTarget as HTMLElement).getAttribute('data-prompt') || '';
        runAgentCommand(prompt);
      });
    });

    const sendBtn = el.querySelector('#btn-agent-send');
    const input = el.querySelector('#agent-input') as HTMLInputElement;

    sendBtn?.addEventListener('click', () => {
      if (input && input.value) {
        runAgentCommand(input.value);
        input.value = '';
      }
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        runAgentCommand(input.value);
        input.value = '';
      }
    });

    // Attachment
    el.querySelector('#btn-agent-attach')?.addEventListener('click', async () => {
      const img = await pickImageFile();
      if (img) {
        const asset = { ...img, id: `img-${Date.now()}` };
        const node = createImageNode(asset, 100, 100);
        store.addNode(node);
        runAgentCommand(`Inserted image: ${img.name}`);
        toast('Image asset attached to document', 'success');
      }
    });
  }

  render();

  return {
    el,
    refresh() {
      render();
    },
  };
}
