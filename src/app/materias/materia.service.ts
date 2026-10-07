import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Materia {
  id_materia: string;
  nome: string;
  quantidadeAlunos?: number;
  cargaHoraria?: string;
  professor?: string;
  status?: number;
  descricao?: string;
  area_conhecimento?: string;
}

@Injectable({
  providedIn: 'root',
})
export class MateriaService {
  private apiUrl = 'http://localhost:3000/api/materias';

  constructor(private http: HttpClient) {}

  listarMaterias(): Observable<Materia[]> {
    return this.http.get<Materia[]>(this.apiUrl);
  }

  criarMateria(payload: { nome: string; area_conhecimento?: string; status?: string | number }): Observable<Materia> {
    return this.http.post<Materia>(this.apiUrl, payload);
  }

  excluirMateria(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  atualizarMateria(id: string, payload: { nome?: string; area_conhecimento?: string; status?: string | number }): Observable<Materia> {
    return this.http.put<Materia>(`${this.apiUrl}/${id}`, payload);
  }
}
