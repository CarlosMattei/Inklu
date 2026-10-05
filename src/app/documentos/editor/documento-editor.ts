import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideArrowLeft, LucideSave, LucideZoomIn, LucideZoomOut } from '@lucide/angular';
import DOMPurify from 'dompurify';

// --- Extensões do TipTap (engine ProseMirror) ------------------------------
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import ImageExtension from '@tiptap/extension-image';
import { Table as TableExtension } from '@tiptap/extension-table';
import TableRowExtension from '@tiptap/extension-table-row';
import TableCellExtension from '@tiptap/extension-table-cell';
import TableHeaderExtension from '@tiptap/extension-table-header';
import { FontSize, TextStyle } from '@tiptap/extension-text-style';
import UnderlineExtension from '@tiptap/extension-underline';
import TextAlignExtension from '@tiptap/extension-text-align';

import { EditorCanvas } from './components/editor-canvas/editor-canvas';
import { EditorPages } from './components/editor-pages/editor-pages';
import { EditorToolbar } from './components/editor-toolbar/editor-toolbar';
import { ModalSaida } from './components/modal-saida/modal-saida';
import { ModalPagina } from './components/modal-pagina/modal-pagina';
import { DocumentConverterService } from './services/document-converter.service';
import { EditorStateService } from './services/editor-state.service';
import { PendingChangesAware } from './pending-changes.guard';
import {
  DEFAULT_TOOLBAR_STATE,
  EditableDocumentFormat,
  EditorCommandName,
  EditorToolbarState,
  TextAlignment,
  PageSettings,
  DEFAULT_PAGE_SETTINGS,
} from './models/editor-document.model';

/** Altura de uma página A4 (29,7 cm) em pixels CSS (1 cm = 96/2,54 px). */
const PX_PER_CM = 96 / 2.54;
/** Respiro superior ao rolar para uma página. */
const PAGE_SCROLL_MARGIN = 24;

/** Tamanhos de papel em cm (largura x altura). */
const PAPER_SIZES_CM: Record<string, { width: number; height: number }> = {
  A4: { width: 21, height: 29.7 },
  A3: { width: 29.7, height: 42 },
  A2: { width: 42, height: 59.4 },
  Letter: { width: 21.6, height: 27.9 },
};

/** Margens predefinidas em cm. */
const MARGIN_PRESETS_CM: Record<string, { top: number; right: number; bottom: number; left: number }> = {
  normal: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
  narrow: { top: 1.27, right: 1.27, bottom: 1.27, left: 1.27 },
  letter: { top: 2.54, right: 2.54, bottom: 2.54, left: 2.54 },
};

/**
 * Tela de edição de documentos (rota em tela cheia).
 *
 * Fluxo: lê o `:id` da rota → busca o HTML convertido (ou um fallback local) →
 * monta o TipTap na folha A4 → sincroniza toolbar, páginas e estado → salva.
 * A saída é protegida pelo `pendingChangesGuard`, que aciona o modal de saída.
 */
@Component({
  selector: 'app-documento-editor',
  imports: [
    CommonModule,
    FormsModule,
    LucideArrowLeft,
    LucideSave,
    LucideZoomIn,
    LucideZoomOut,
    EditorToolbar,
    EditorCanvas,
    EditorPages,
    ModalSaida,
    ModalPagina,
  ],
  templateUrl: './documento-editor.html',
  styleUrl: './documento-editor.scss',
})
export class DocumentoEditor implements OnInit, AfterViewInit, OnDestroy, PendingChangesAware {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly converter = inject(DocumentConverterService);
  private readonly state = inject(EditorStateService);

  /** Referência ao canvas para descobrir o elemento onde montar o TipTap. */
  @ViewChild(EditorCanvas) private canvas?: EditorCanvas;
  /** Container rolável usado no cálculo das páginas. */
  @ViewChild('viewport') private viewport?: ElementRef<HTMLElement>;

  private editor: Editor | null = null;
  /** Aguarda o view estar pronto antes de montar o editor. */
  private viewInitialized = false;
  private pendingContent: string | null = null;
  /** Resolve a navegação pendente aguardando a resposta do modal de saída. */
  private pendingExit: ((canLeave: boolean) => void) | null = null;
  /** Evita abrir o modal duas vezes quando a saída já foi confirmada. */
  private skipGuard = false;

  // ─── Estado exposto ao template (delegado ao EditorStateService) ──────────
  readonly documentName = this.state.documentName;
  readonly isSaving = this.state.isSaving;
  readonly hasUnsavedChanges = this.state.hasUnsavedChanges;
  readonly zoomLevel = this.state.zoomLevel;
  readonly fontSize = this.state.fontSize;
  readonly pageSettings = this.state.pageSettings;

  readonly documentId = signal<string | null>(null);
  readonly originalFormat = signal<EditableDocumentFormat>('docx');
  readonly isLoading = signal(true);
  readonly editorReady = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly wordCount = signal(0);
  readonly toolbarState = signal<EditorToolbarState>(DEFAULT_TOOLBAR_STATE);

  // ─── Páginas e modais ─────────────────────────────────────────────────────
  readonly pageCount = signal(1);
  readonly currentPage = signal(1);
  readonly exitDialogOpen = signal(false);
  readonly pageDialogOpen = signal(false);

  /** Só permite salvar quando há alterações reais e conteúdo não vazio. */
  readonly canSave = computed(
    () => !this.isSaving() && this.hasUnsavedChanges() && this.wordCount() > 0,
  );

  /** Altura útil de conteúdo da página em pixels CSS, baseada nas configurações atuais. */
  readonly pageContentHeightPx = computed(() => {
    const settings = this.pageSettings();
    const paperSize = settings.paperSize;
    const orientation = settings.orientation;

    // Obtém dimensões do papel
    let dimensions = PAPER_SIZES_CM[paperSize] ?? PAPER_SIZES_CM['A4'];
    if (settings.paperSize === 'Custom' && settings.customPaperSize) {
      dimensions = settings.customPaperSize;
    }

    // Troca largura/altura se landscape
    const pageHeightCm = orientation === 'landscape' ? dimensions.width : dimensions.height;

    // Obtém margens
    let margins = MARGIN_PRESETS_CM[settings.margin] ?? MARGIN_PRESETS_CM['normal'];
    if (settings.margin === 'custom' && settings.customMargin) {
      margins = settings.customMargin;
    }

    const contentHeightCm = pageHeightCm - margins.top - margins.bottom;
    return contentHeightCm * PX_PER_CM;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (!id) {
      void this.router.navigate(['/documentos']);
      return;
    }

    this.state.reset();
    this.currentPage.set(1);
    this.documentId.set(id);
    void this.loadDocument(id);
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;

    // O conteúdo pode chegar antes do view; nesse caso montamos agora.
    if (this.pendingContent !== null) {
      this.initEditor(this.pendingContent);
      this.pendingContent = null;
    }
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = null;
    this.state.reset();
  }

  // ─── Carregamento ─────────────────────────────────────────────────────────

  private async loadDocument(id: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    // O nome pode vir por query string (o backend ainda não expõe metadados).
    const fallbackName = this.route.snapshot.queryParamMap.get('name') ?? undefined;

    try {
      const document = await this.converter.getDocumentForEditing(id, fallbackName);
      this.state.setDocument(document);
      this.originalFormat.set(document.originalFormat);

      // Sanitiza o HTML antes de injetar no editor (mitiga XSS).
      const safeHtml = DOMPurify.sanitize(document.htmlContent);

      if (this.viewInitialized) {
        this.initEditor(safeHtml);
      } else {
        this.pendingContent = safeHtml;
      }
    } catch (error) {
      console.error('Falha ao carregar documento:', error);
      this.errorMessage.set('Não foi possível carregar o documento para edição.');
    } finally {
      this.isLoading.set(false);
    }
  }

  private initEditor(content: string): void {
    const element = this.canvas?.element;
    if (!element) return;

    this.editor?.destroy();

    this.editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          // O sublinhado é adicionado explicitamente logo abaixo.
          underline: false,
        }),
        UnderlineExtension,
        TextStyle,
        FontSize,
        TextAlignExtension.configure({ types: ['heading', 'paragraph'] }),
        ImageExtension.configure({ inline: false, allowBase64: true }),
        TableExtension.configure({ resizable: true, HTMLAttributes: { class: 'editor-table' } }),
        TableRowExtension,
        TableHeaderExtension,
        TableCellExtension,
      ],
      content,
      editorProps: { attributes: { class: 'editor-content' } },
      onUpdate: () => {
        // Qualquer edição marca o documento como "sujo" e atualiza a UI.
        this.state.markDirty();
        this.syncToolbarState();
        this.updateWordCount();
        this.recomputePages();
      },
      onSelectionUpdate: () => this.syncToolbarState(),
    });

    this.editorReady.set(true);
    this.syncToolbarState();
    this.updateWordCount();
    this.recomputePages();
    this.currentPage.set(1);
  }

  /** Reflete a formatação da seleção atual na toolbar. */
  private syncToolbarState(): void {
    const editor = this.editor;
    if (!editor) return;

    const textStyle = editor.getAttributes('textStyle') as { fontSize?: string };
    const alignment: TextAlignment = editor.isActive({ textAlign: 'center' })
      ? 'center'
      : editor.isActive({ textAlign: 'right' })
        ? 'right'
        : editor.isActive({ textAlign: 'justify' })
          ? 'justify'
          : 'left';

    this.toolbarState.set({
      isBold: editor.isActive('bold'),
      isItalic: editor.isActive('italic'),
      isUnderline: editor.isActive('underline'),
      currentHeading: editor.isActive('heading', { level: 1 })
        ? 1
        : editor.isActive('heading', { level: 2 })
          ? 2
          : null,
      currentFontSize: (textStyle.fontSize ?? `${this.fontSize()}`).replace('pt', ''),
      alignment,
    });
  }

  private updateWordCount(): void {
    const text = this.editor?.getText().trim() ?? '';
    this.wordCount.set(text ? text.split(/\s+/).length : 0);
  }

  // ─── Páginas ──────────────────────────────────────────────────────────────

  /** Recalcula a quantidade de páginas a partir da altura do conteúdo. */
  private recomputePages(): void {
    const content = this.editorContent();

    if (!content) {
      this.pageCount.set(1);
      return;
    }

    const count = Math.max(1, Math.ceil((content.scrollHeight - 1) / this.pageContentHeightPx()));
    this.pageCount.set(count);
    this.currentPage.set(Math.min(this.currentPage(), count));
  }

  /** Rola o viewport até a página selecionada na ilha lateral. */
  goToPage(page: number): void {
    const viewport = this.viewport?.nativeElement;
    const content = this.editorContent();
    if (!viewport || !content) return;

    const pageHeight = this.pageContentHeightPx() * (this.zoomLevel() / 100);
    const offset = content.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    const delta = offset + (page - 1) * pageHeight - PAGE_SCROLL_MARGIN;

    viewport.scrollBy({ top: delta, behavior: 'smooth' });
    this.currentPage.set(page);
  }

  /** Mantém a página atual em sincronia com a rolagem do usuário. */
  onViewportScroll(): void {
    this.updateCurrentPageFromScroll();
  }

  private updateCurrentPageFromScroll(): void {
    const viewport = this.viewport?.nativeElement;
    const content = this.editorContent();
    if (!viewport || !content) return;

    const pageHeight = this.pageContentHeightPx() * (this.zoomLevel() / 100);
    const offset =
      viewport.getBoundingClientRect().top -
      content.getBoundingClientRect().top +
      PAGE_SCROLL_MARGIN;
    const page = Math.floor(Math.max(0, offset) / pageHeight) + 1;

    this.currentPage.set(Math.min(this.pageCount(), Math.max(1, page)));
  }

  private editorContent(): HTMLElement | null {
    return (this.editor?.view.dom as HTMLElement | undefined) ?? null;
  }

  // ─── Comandos da toolbar ──────────────────────────────────────────────────

  runCommand(command: EditorCommandName): void {
    const editor = this.editor;
    if (!editor) return;

    switch (command) {
      case 'bold':
        editor.chain().focus().toggleBold().run();
        break;
      case 'italic':
        editor.chain().focus().toggleItalic().run();
        break;
      case 'underline':
        editor.chain().focus().toggleUnderline().run();
        break;
      case 'heading1':
        editor.chain().focus().toggleHeading({ level: 1 }).run();
        break;
      case 'heading2':
        editor.chain().focus().toggleHeading({ level: 2 }).run();
        break;
      case 'align-left':
        editor.chain().focus().setTextAlign('left').run();
        break;
      case 'align-center':
        editor.chain().focus().setTextAlign('center').run();
        break;
      case 'align-right':
        editor.chain().focus().setTextAlign('right').run();
        break;
      case 'image':
        this.insertImage();
        break;
      case 'table':
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        break;
    }

    this.syncToolbarState();
  }

  setFontSize(size: string): void {
    this.state.setFontSize(size);
    this.editor?.chain().focus().setFontSize(`${size}pt`).run();
    this.syncToolbarState();
  }

  /** Abre o seletor de arquivo e insere a imagem como Base64 no documento. */
  private insertImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const base64 = await this.fileToBase64(file);
      this.editor?.chain().focus().setImage({ src: base64 }).run();
    };

    input.click();
  }

  // ─── Header / zoom ────────────────────────────────────────────────────────

  onNameChange(name: string): void {
    this.state.setName(name);
  }

  onZoomIn(): void {
    this.state.zoomIn();
    this.schedulePageSync();
  }

  onZoomOut(): void {
    this.state.zoomOut();
    this.schedulePageSync();
  }

  /** O zoom é animado; revalidamos a página após a transição terminar. */
  private schedulePageSync(): void {
    setTimeout(() => this.updateCurrentPageFromScroll(), 180);
  }

  // ─── Salvamento / navegação ───────────────────────────────────────────────

  async save(): Promise<void> {
    const editor = this.editor;
    const id = this.documentId();
    if (!editor || !id) return;

    this.state.setSaving(true);
    this.errorMessage.set(null);

    try {
      const html = editor.getHTML();
      const result = await this.converter.saveDocument(id, html, 'docx', {
        name: this.documentName(),
        fontSize: Number.parseInt(this.fontSize(), 10),
      });

      this.state.markSaved();

      if (result.downloadUrl) {
        window.open(result.downloadUrl, '_blank', 'noopener');
      } else if (result.local) {
        // Sem backend: oferece o HTML gerado como download local.
        this.downloadLocalHtml(html);
      }
    } catch (error) {
      console.error('Erro ao salvar documento:', error);
      this.errorMessage.set('Não foi possível salvar o documento.');
    } finally {
      this.state.setSaving(false);
    }
  }

  goBack(): void {
    if (!this.hasUnsavedChanges()) {
      void this.router.navigate(['/documentos']);
      return;
    }

    // Com alterações pendentes, pede confirmação via modal antes de navegar.
    void this.requestExit().then((canLeave) => {
      if (!canLeave) return;
      this.skipGuard = true;
      void this.router.navigate(['/documentos']);
    });
  }

  // ─── Guard / modal de saída ───────────────────────────────────────────────

  /** Chamado pelo guard (ex.: voltar do navegador): só bloqueia com alterações. */
  canDeactivate(): boolean | Promise<boolean> {
    if (this.skipGuard || !this.hasUnsavedChanges()) return true;
    return this.requestExit();
  }

  /** Abre o modal de saída e resolve conforme a escolha do usuário. */
  private requestExit(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.pendingExit = resolve;
      this.exitDialogOpen.set(true);
    });
  }

  onExitCancel(): void {
    this.resolveExit(false);
  }

  onExitDiscard(): void {
    this.resolveExit(true);
  }

  async onExitSave(): Promise<void> {
    const resolve = this.pendingExit;
    this.pendingExit = null;

    await this.save();
    this.exitDialogOpen.set(false);
    // Permanece na tela se o salvamento não tiver concluído.
    resolve?.(!this.hasUnsavedChanges());
  }

  private resolveExit(canLeave: boolean): void {
    const resolve = this.pendingExit;
    this.pendingExit = null;
    this.exitDialogOpen.set(false);
    resolve?.(canLeave);
  }

  // ─── Modal de configurações de página ───────────────────────────────────────

  /** Abre o modal de configurações de página. */
  onEditPage(): void {
    this.pageDialogOpen.set(true);
  }

  /** Fecha o modal de configurações de página sem salvar. */
  onPageCancel(): void {
    this.pageDialogOpen.set(false);
  }

  /** Salva as configurações de página e atualiza o canvas. */
  onPageSave(settings: PageSettings): void {
    this.state.setPageSettings(settings);
    this.applyPageSettings(settings);
    this.pageDialogOpen.set(false);
    this.recomputePages();
  }

  /** Aplica as configurações de página ao editor e canvas. */
  private applyPageSettings(settings: PageSettings): void {
    const editor = this.editor;
    const canvas = this.canvas;
    if (!editor || !canvas) return;

    // Atualiza o espaçamento entre linhas no conteúdo do editor
    const lineHeight = settings.lineSpacing ?? DEFAULT_PAGE_SETTINGS.lineSpacing;
    editor.chain().focus().setLineHeight(`${lineHeight}`).run();
  }

  // ─── Utilidades ───────────────────────────────────────────────────────────

  private downloadLocalHtml(html: string): void {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `${this.documentName().replace(/\.[^.]+$/, '')}.html`;
    anchor.click();

    URL.revokeObjectURL(url);
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
}
