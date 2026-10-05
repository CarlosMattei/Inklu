import { Component, ElementRef, Input, ViewChild } from '@angular/core';

/**
 * Wrapper da folha A4.
 *
 * O TipTap (ProseMirror) é montado diretamente no elemento `#sheet` exposto
 * pelo getter `element`, mantendo o componente principal no controle do editor.
 * As guias de página são um overlay separado da folha (para não interferir no
 * conteúdo gerenciado pelo ProseMirror).
 */
@Component({
  selector: 'app-editor-canvas',
  templateUrl: './editor-canvas.html',
  styleUrl: './editor-canvas.scss',
})
export class EditorCanvas {
  /** Nível de zoom da folha, em porcentagem. */
  @Input() zoom = 100;
  /** Exibe o estado visual de carregamento enquanto o conteúdo é convertido. */
  @Input() isLoading = false;
  /** Quantidade de páginas, usada para desenhar as quebras. */
  @Input() pageCount = 1;

  @ViewChild('sheet', { static: true }) private readonly sheet!: ElementRef<HTMLElement>;

  /** Elemento DOM onde o TipTap deve ser inicializado. */
  get element(): HTMLElement {
    return this.sheet.nativeElement;
  }

  /**
   * Guias de quebra: uma linha no fim de cada página.
   * A altura útil é A4 (29,7 cm) menos as margens de 2,5 cm.
   */
  guides(): Array<{ page: number; top: string }> {
    const boundaries = Math.max(0, Math.floor(this.pageCount) - 1);

    return Array.from({ length: boundaries }, (_, index) => ({
      page: index + 2,
      top: `calc(2.5cm + ${index + 1} * 24.7cm)`,
    }));
  }
}
