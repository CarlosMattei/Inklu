import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { EditablePlano, PlanoSummary, SavePlano, TipoPlano } from '../models/plano.model';

@Injectable({ providedIn: 'root' })
export class PlanoService {
  private readonly http = inject(HttpClient);
  private url(alunoId: string) { return `http://localhost:3000/api/alunos/${encodeURIComponent(alunoId)}/planos`; }

  list(alunoId: string) { return firstValueFrom(this.http.get<PlanoSummary[]>(this.url(alunoId))); }
  template(alunoId: string, type: TipoPlano, bimestre: string, anoLetivo: number) {
    return firstValueFrom(this.http.get<EditablePlano>(`${this.url(alunoId)}/${type}/modelo`, { params: { bimestre, anoLetivo } }));
  }
  get(alunoId: string, type: TipoPlano, id: string) {
    return firstValueFrom(this.http.get<EditablePlano>(`${this.url(alunoId)}/${type}/${id}`));
  }
  save(alunoId: string, type: TipoPlano, body: SavePlano) {
    return firstValueFrom(this.http.post<EditablePlano>(`${this.url(alunoId)}/${type}`, body));
  }
  import(alunoId: string, type: TipoPlano, file: File, bimestre: string, anoLetivo: number): Promise<EditablePlano> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.readAsDataURL(file);
    }).then(fileBase64 => firstValueFrom(this.http.post<EditablePlano>(`${this.url(alunoId)}/${type}/importar`, {
      fileName: file.name, fileBase64, bimestre, anoLetivo,
    })));
  }
  export(alunoId: string, type: TipoPlano, id: string, format: 'docx' | 'pdf') {
    return firstValueFrom(this.http.post(`${this.url(alunoId)}/${type}/${id}/exportar`, { format }, { responseType: 'blob' }));
  }
}
