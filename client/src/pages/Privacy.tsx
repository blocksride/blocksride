import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export const Privacy = () => {
    const navigate = useNavigate()

    return (
        <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20">
            <header className="fixed top-0 z-50 w-full border-b border-border bg-background/90 backdrop-blur-md">
                <div className="h-14 flex items-center justify-between px-6 container mx-auto max-w-[1000px]">
                    <div
                        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => navigate('/')}
                    >
                        <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-bold font-mono tracking-tight">BLOCKSRIDE // PRIVACY</span>
                    </div>
                </div>
            </header>

            <main className="pt-24 pb-24 container mx-auto px-6 max-w-[800px]">
                <h1 className="text-4xl font-black tracking-tighter mb-2">PRIVACY POLICY</h1>
                <p className="text-sm font-mono text-muted-foreground mb-12 uppercase tracking-wide">Last Updated: March 2026</p>

                <div className="prose prose-invert prose-sm max-w-none space-y-12">
                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">01</span>
                            OVERVIEW
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            This Privacy Policy explains how BlocksRide collects, uses, and shares information when you access the
                            BlocksRide interface, connect a wallet, sign in, or interact with supported onchain features.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">02</span>
                            INFORMATION WE COLLECT
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            We may collect wallet addresses, authentication identifiers, transaction hashes, session data, device and
                            browser metadata, IP-derived network information, and support communications. We may also store limited
                            profile and gameplay-related data needed to operate the app.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">03</span>
                            HOW WE USE INFORMATION
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            We use information to authenticate users, secure sessions, facilitate wallet-related actions, operate market
                            features, troubleshoot issues, prevent abuse, comply with legal obligations, and improve the product.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">04</span>
                            THIRD-PARTY SERVICES
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            BlocksRide relies on third-party infrastructure and service providers, which may include authentication,
                            wallet, database, analytics, RPC, payments, and compliance providers. Their handling of your information is
                            governed by their own terms and privacy policies.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">05</span>
                            ONCHAIN DATA
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            Blockchain data is public by design. If you connect a wallet or submit onchain transactions, those actions
                            may be permanently visible on public block explorers and cannot generally be deleted by BlocksRide.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">06</span>
                            DATA RETENTION AND SECURITY
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            We retain information only as long as reasonably necessary for product operations, security, recordkeeping,
                            and compliance. We use reasonable administrative and technical safeguards, but no system can guarantee
                            absolute security.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">07</span>
                            CONTACT
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            If you have questions about this Privacy Policy, contact the BlocksRide team through the official app or
                            support channels published on our website.
                        </p>
                    </section>
                </div>

                <div className="mt-24 pt-8 border-t border-border flex justify-between items-center">
                    <p className="text-xs text-muted-foreground">© 2026 BLOCKSRIDE</p>
                    <Button variant="outline" size="sm" onClick={() => navigate('/')}>Return Home</Button>
                </div>
            </main>
        </div>
    )
}
