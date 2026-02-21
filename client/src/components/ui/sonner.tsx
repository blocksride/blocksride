import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      className="toaster group"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'group toast w-full font-mono bg-zinc-950 border border-zinc-800 rounded-lg p-4 shadow-xl shadow-black/20 flex items-start gap-3',
          title: 'text-xs font-bold text-zinc-100',
          description: 'text-[11px] text-zinc-400 mt-1',
          actionButton:
            'px-3 py-1.5 text-[10px] font-bold bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30 rounded transition-all',
          cancelButton:
            'px-3 py-1.5 text-[10px] font-bold bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-zinc-700 rounded transition-all',
          success: 'border-green-500/30 bg-green-500/5',
          error: 'border-red-500/30 bg-red-500/5',
          warning: 'border-yellow-500/30 bg-yellow-500/5',
          info: 'border-blue-500/30 bg-blue-500/5',
          icon: 'w-4 h-4 mt-0.5',
        },
      }}
      icons={{
        success: <span className="text-green-400 text-xs font-bold mr-2">[OK]</span>,
        error: <span className="text-red-400 text-xs font-bold mr-2">[ERR]</span>,
        warning: <span className="text-yellow-400 text-xs font-bold mr-2">[WARN]</span>,
        info: <span className="text-blue-400 text-xs font-bold mr-2">[INFO]</span>,
        loading: <span className="text-zinc-400 text-xs font-bold mr-2 animate-pulse">[...]</span>,
      }}
      {...props}
    />
  )
}

export { Toaster }
