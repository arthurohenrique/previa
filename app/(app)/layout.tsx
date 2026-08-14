import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/supabase/server'
import { SplitView } from '@/components/SplitView'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  return (
    <SplitView
      professionalName={profile.full_name}
      council={
        profile.council_type && profile.council_number
          ? `${profile.council_type} ${profile.council_number}`
          : null
      }
    >
      {children}
    </SplitView>
  )
}
