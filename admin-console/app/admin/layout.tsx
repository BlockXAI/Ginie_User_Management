import Nav from '../../components/Nav'
import Protected from '../../components/Protected'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Protected>
      <Nav />
      {children}
    </Protected>
  )
}
