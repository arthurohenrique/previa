// Tipos do banco, escritos à mão e mantidos em par com supabase/migrations.
//
// Nenhuma tabela tem coluna de imagem. Se você precisar adicionar uma, releia a
// seção 2 da especificação: não é para existir.

export type AppRole = 'admin' | 'professional'

export type CouncilType = 'CRM' | 'CRO' | 'CRF' | 'CRBM' | 'COREN'

/** Técnicas de simulação. Efeitos visuais distintos, não níveis do mesmo controle. */
export type Technique = 'filler' | 'toxin' | 'biostimulator' | 'rhinomodeling'

export type ConsentPurpose = 'simulation'

export type AuditAction = 'insert' | 'update' | 'delete'

export type ClinicRow = {
  id: string
  name: string
  cnpj: string | null
  created_at: string
}

export type ProfileRow = {
  id: string
  clinic_id: string
  full_name: string
  council_type: CouncilType | null
  council_number: string | null
  role: AppRole
  created_at: string
}

export type PatientRow = {
  id: string
  clinic_id: string
  full_name: string
  birth_year: number | null
  created_by: string
  created_at: string
}

export type ConsentRow = {
  id: string
  patient_id: string
  professional_id: string
  purpose: ConsentPurpose
  granted_at: string
  revoked_at: string | null
  signature_svg: string
  terms_version: string
}

export type SessionRow = {
  id: string
  patient_id: string
  professional_id: string
  clinic_id: string
  created_at: string
  /** Ponteiro para o IndexedDB do dispositivo. Nunca a imagem. */
  local_image_ref: string
  ipd_px: number
  yaw: number
  pitch: number
  roll: number
}

export type RegionRow = {
  id: string
  label: string
  symmetric: boolean
  sort_order: number
}

export type ApplicationRow = {
  id: string
  session_id: string
  region_id: string
  technique: Technique
  point_u: number
  point_v: number
  anchor_landmark: number
  anchor_offset_u: number
  anchor_offset_v: number
  /** Adimensional 0..1. Não é dose, não é volume, não é unidade. */
  intensity: number
  /** Raio em fração de DIP. Nunca pixel. */
  radius_ipd: number
  created_at: string
}

export type RegionPresetRow = {
  id: string
  clinic_id: string
  region_id: string
  technique: Technique
  label: string
  default_intensity: number
  default_radius_ipd: number
  notes: string | null
  created_at: string
}

export type AuditLogRow = {
  id: number
  actor_id: string | null
  action: AuditAction
  entity: string
  entity_id: string
  at: string
  meta: Record<string, unknown>
}

type Table<Row, Insert = Row, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

/**
 * Achata a interseção num único tipo mapeado.
 *
 * Sem isto, `Pick<…> & Partial<…>` continua sendo uma interseção, e o TypeScript
 * não infere assinatura de índice para interseções. O schema deixa de satisfazer
 * `Record<string, GenericTable>` do postgrest-js, o cliente inteiro degrada, e
 * toda linha vira `never` sem que nenhum erro aponte para a causa.
 */
type Flatten<T> = { [K in keyof T]: T[K] }

type WithDefaults<Row, Required extends keyof Row> = Flatten<
  Pick<Row, Required> & Partial<Omit<Row, Required>>
>

export interface Database {
  public: {
    Tables: {
      clinics: Table<ClinicRow, WithDefaults<ClinicRow, 'name'>>
      profiles: Table<ProfileRow, WithDefaults<ProfileRow, 'id' | 'clinic_id' | 'full_name'>>
      patients: Table<PatientRow, WithDefaults<PatientRow, 'full_name'>>
      consents: Table<
        ConsentRow,
        WithDefaults<ConsentRow, 'patient_id' | 'signature_svg' | 'terms_version'>
      >
      sessions: Table<
        SessionRow,
        WithDefaults<
          SessionRow,
          'patient_id' | 'local_image_ref' | 'ipd_px' | 'yaw' | 'pitch' | 'roll'
        >
      >
      regions: Table<RegionRow>
      applications: Table<
        ApplicationRow,
        WithDefaults<
          ApplicationRow,
          | 'session_id'
          | 'region_id'
          | 'technique'
          | 'point_u'
          | 'point_v'
          | 'anchor_landmark'
          | 'anchor_offset_u'
          | 'anchor_offset_v'
          | 'intensity'
          | 'radius_ipd'
        >
      >
      region_presets: Table<
        RegionPresetRow,
        WithDefaults<
          RegionPresetRow,
          'region_id' | 'technique' | 'label' | 'default_intensity' | 'default_radius_ipd'
        >
      >
      audit_log: Table<AuditLogRow, WithDefaults<AuditLogRow, 'action' | 'entity' | 'entity_id'>>
    }
    // Sem views. E o vazio precisa ser `Record<never, never>`, não
    // `Record<string, never>`: o postgrest-js resolve as relações com
    // `Tables & Views`, e interseção com uma assinatura de índice `never`
    // transforma toda tabela em `never` sem erro nenhum apontar a causa.
    Views: Record<never, never>
    Functions: {
      current_clinic_id: { Args: Record<string, never>; Returns: string }
      is_clinic_admin: { Args: Record<string, never>; Returns: boolean }
    }
    Enums: {
      app_role: AppRole
      council_type: CouncilType
      technique: Technique
      consent_purpose: ConsentPurpose
      audit_action: AuditAction
    }
    CompositeTypes: Record<never, never>
  }
}
