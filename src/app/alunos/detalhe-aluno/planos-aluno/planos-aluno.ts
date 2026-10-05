import { Component, OnChanges, Input, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PlanoService } from '../../../documentos/editor/services/plano.service';
import { PlanoSummary } from '../../../documentos/editor/models/plano.model';

@Component({
  selector: 'app-planos-aluno', imports: [RouterLink, DatePipe],
  templateUrl: './planos-aluno.html', styleUrl: './planos-aluno.scss',
})
export class PlanosAluno implements OnChanges {
  @Input({ required: true }) alunoId!: string;
  private readonly service = inject(PlanoService);
  readonly plans = signal<PlanoSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly showHistory = signal(false);
  readonly visiblePlans = computed(() => {
    const plans = this.plans();
    if (this.showHistory()) return plans;
    const roots = new Set<string>();
    return plans.filter(plan => { if (roots.has(plan.rootId)) return false; roots.add(plan.rootId); return true; });
  });

  ngOnChanges() { void this.load(); }
  async load() {
    const id = this.alunoId;
    this.loading.set(true); this.error.set('');
    try { const plans = await this.service.list(id); if (id === this.alunoId) this.plans.set(plans); }
    catch { this.error.set('Não foi possível carregar os planos.'); }
    finally { this.loading.set(false); }
  }
}
