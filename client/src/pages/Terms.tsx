import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export const Terms = () => {
    const navigate = useNavigate()

    return (
        <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20">
            { }
            <header className="fixed top-0 z-50 w-full border-b border-border bg-background/90 backdrop-blur-md">
                <div className="h-14 flex items-center justify-between px-6 container mx-auto max-w-[1000px]">
                    <div
                        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => navigate('/')}
                    >
                        <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-bold font-mono tracking-tight">BLIP<span className="text-primary">MARKETS</span> // TERMS</span>
                    </div>
                </div>
            </header>

            <main className="pt-24 pb-24 container mx-auto px-6 max-w-[800px]">
                <h1 className="text-4xl font-black tracking-tighter mb-2">TERMS OF SERVICE</h1>
                <p className="text-sm font-mono text-muted-foreground mb-12 uppercase tracking-wide">Last Updated: December 2025</p>

                <div className="prose prose-invert prose-sm max-w-none space-y-12">

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">01</span>
                            ACCEPTANCE OF TERMS
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            By accessing, connecting your wallet, or using the Eth Ride Interface (the "Interface"), you agree that you have read, understood, and accepted all of the terms and conditions contained in this Agreement. If you do not agree, you must immediately discontinue use of the Interface.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">02</span>
                            NO FINANCIAL ADVICE
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            Eth Ride is a non-custodial interface for interacting with smart contracts on the Sepolia testnet. We do not provide financial, investment, legal, or tax advice. All interactions are solely your responsibility. You acknowledge that crypto-assets are experimental and carry significant risks.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">03</span>
                            TESTNET USAGE
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            This application currently operates on the <strong>Sepolia Testnet</strong>. Assets obtained, staked, or won on this platform have <strong>no real-world monetary value</strong>. They are for testing and simulation purposes only.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">04</span>
                            PROHIBITED JURISDICTIONS
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            You agree not to use the Interface if you are located in, established in, or a resident of any jurisdiction where use of the Interface would be illegal or violate any applicable laws.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-3">
                            <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded-sm">05</span>
                            LIMITATION OF LIABILITY
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            To the fullest extent permitted by law, Eth Ride shall not be liable for any direct, indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, use, goodwill, or other intangible losses.
                        </p>
                    </section>

                </div>

                <div className="mt-24 pt-8 border-t border-border flex justify-between items-center">
                    <p className="text-xs text-muted-foreground">© 2025 BLIP MARKETS</p>
                    <Button variant="outline" size="sm" onClick={() => navigate('/')}>Return Home</Button>
                </div>
            </main>
        </div>
    )
}
