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
import { toast, promptDialog } from './dialogs';
import { processFilesToAttachments, type AttachmentItem } from './attachments';
import { loadSettings, saveSettings } from '../core/settings';

export interface AgentOptions {
  onGenerate?(docName: string): void;
}

interface AgentPreset {
  id: string;
  name: string;
  instructions: string;
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
  let agentAttachments: AttachmentItem[] = [];
  const storageKey = `penclone.agent.${store.fileName}`;
  const presetsKey = 'penclone.agent.presets';

  function getPresets(): AgentPreset[] {
    try {
      const raw = localStorage.getItem(presetsKey);
      if (raw) return JSON.parse(raw);
    } catch {
      // Ignore
    }
    return [
      { id: 'default', name: 'Default UI Designer', instructions: 'Generate clean modern UI frames and components.' },
      { id: 'tailwind', name: 'Tailwind Specialist', instructions: 'Focus on atomic tokens and utility layout structures.' },
    ];
  }

  function savePresets(list: AgentPreset[]) {
    try {
      localStorage.setItem(presetsKey, JSON.stringify(list));
    } catch {
      // Ignore
    }
  }

  let presets = getPresets();
  let activePresetId = presets[0]?.id || 'default';

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
    const currentPreset = presets.find((p) => p.id === activePresetId) || presets[0];

    el.innerHTML = `
      <!-- Presets Header -->
      <div style="display: flex; gap: 6px; align-items: center; justify-content: space-between;">
        <div style="flex: 1; position: relative;">
          <select id="select-agent-preset" class="pen-form-input" style="height: 28px; font-size: 11px; padding: 0 8px; width: 100%; cursor: pointer;">
            ${presets
              .map(
                (p) => `
              <option value="${p.id}" ${p.id === activePresetId ? 'selected' : ''}>${p.name}</option>
            `
              )
              .join('')}
          </select>
        </div>
        <button class="pen-btn-secondary" id="btn-new-preset" style="height: 28px; padding: 0 8px; font-size: 11px; gap: 4px;" title="Create new agent preset">
          ${svgIcon('plus', 12)}
          <span>New</span>
        </button>
        <button class="pen-icon-btn" id="btn-clear-chat" title="Clear chat history">
          ${svgIcon('trash', 12)}
        </button>
      </div>

      <div style="font-size: 10px; color: var(--faint); padding: 4px 6px; background: rgba(255, 255, 255, 0.02); border-radius: 4px;">
        Local demo — no network. Preset: <strong>${currentPreset?.name || 'Default'}</strong>.
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

      <!-- Attachment chips if any -->
      ${
        agentAttachments.length > 0
          ? `
        <div style="display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 0;">
          ${agentAttachments
            .map(
              (a) => `
            <div class="pen-attachment-chip" style="font-size: 10px; padding: 2px 6px;">
              <span>${svgIcon(a.type === 'image' ? 'image' : 'file-text', 11)}</span>
              <span class="name">${a.name}</span>
              <button type="button" class="pen-attachment-remove" data-remove-agent-att="${a.id}">
                ${svgIcon('minus', 9)}
              </button>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : ''
      }

      <div style="font-size: 11px; font-weight: 600; color: var(--fg-strong); margin-top: 2px;">
        Suggested actions
      </div>

      <div class="pen-agent-chips" style="max-height: 110px; overflow-y: auto;">
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
        <input type="file" id="agent-file-input" multiple accept="image/*,.pen,.md,.txt,.json,.ts,.js,.jsx,.tsx" style="display: none;" />
        <button class="pen-icon-btn" id="btn-agent-attach" title="Attach file or image">
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
    // Presets dropdown
    const presetSelect = el.querySelector('#select-agent-preset') as HTMLSelectElement;
    presetSelect?.addEventListener('change', () => {
      activePresetId = presetSelect.value;
      const p = presets.find((x) => x.id === activePresetId);
      if (p) {
        toast(`Active preset: ${p.name}`, 'info');
      }
      render();
    });

    // Create New Preset
    el.querySelector('#btn-new-preset')?.addEventListener('click', async () => {
      const name = await promptDialog({
        title: 'New Agent Preset',
        label: 'Preset Name',
        placeholder: 'e.g. Design System Architect',
      });
      if (!name) return;

      const instructions = await promptDialog({
        title: 'Preset Instructions',
        label: 'Instructions',
        placeholder: 'e.g. Emphasize accessible contrast and minimal typography',
      });

      const newP: AgentPreset = {
        id: `preset-${Date.now()}`,
        name,
        instructions: instructions || '',
      };
      presets.push(newP);
      activePresetId = newP.id;
      savePresets(presets);
      toast(`Created preset "${name}"`, 'success');
      render();
    });

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

    // File input for attachments
    const fileInput = el.querySelector('#agent-file-input') as HTMLInputElement;
    el.querySelector('#btn-agent-attach')?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', async () => {
      if (fileInput.files && fileInput.files.length > 0) {
        const newAtts = await processFilesToAttachments(fileInput.files);
        agentAttachments = [...agentAttachments, ...newAtts].slice(0, 4);

        // If image attached, insert into canvas as well
        for (const att of newAtts) {
          if (att.type === 'image' && att.dataUrl) {
            const asset = {
              id: att.id,
              name: att.name,
              dataUrl: att.dataUrl,
              width: 300,
              height: 200,
              size: att.size,
            };
            const node = createImageNode(asset, 100, 100);
            store.addNode(node);
          }
        }

        render();
        toast('Files attached to agent session', 'success');
      }
    });

    // Remove agent attachment
    el.querySelectorAll('[data-remove-agent-att]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).getAttribute('data-remove-agent-att');
        agentAttachments = agentAttachments.filter((a) => a.id !== id);
        render();
      });
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
