import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { authService } from '@/services/authService'
import { MessageCircle, X, Send, User as UserIcon, Minimize2, Maximize2 } from 'lucide-react'

interface ChatMessage {
    type: 'message' | 'system'
    content: string
    sender: string
    sender_id: string
    timestamp: number
}

const getUserColor = (username: string) => {
    const colors = [
        'text-red-600 dark:text-red-400', 'text-orange-600 dark:text-orange-400', 'text-amber-600 dark:text-amber-400',
        'text-lime-600 dark:text-lime-400', 'text-emerald-600 dark:text-emerald-400', 'text-cyan-600 dark:text-cyan-400',
        'text-blue-600 dark:text-blue-400', 'text-violet-600 dark:text-violet-400', 'text-fuchsia-600 dark:text-fuchsia-400',
        'text-pink-600 dark:text-pink-400', 'text-rose-600 dark:text-rose-400'
    ]
    let hash = 0
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
}

export const ChatWindow = () => {
    const { user, refreshUser } = useAuth()

    const [isOpen, setIsOpen] = useState(false)
    const [isMinimized, setIsMinimized] = useState(false)
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [inputValue, setInputValue] = useState('')
    const [nicknameInput, setNicknameInput] = useState('')
    const [ws, setWs] = useState<WebSocket | null>(null)
    const [error, setError] = useState<string | null>(null)

    const messagesEndRef = useRef<HTMLDivElement>(null)


    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, isOpen, isMinimized])


    useEffect(() => {
        if (!isOpen || !user?.nickname) return

        let socket: WebSocket

        const connect = () => {
            try {
                const token = localStorage.getItem('auth_token')
                if (!token) return

                const wsBase = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'
                const wsUrl = `${wsBase}/api/chat/ws?token=${token}`

                socket = new WebSocket(wsUrl)

                socket.onopen = () => {
                    setError(null)
                }

                socket.onmessage = (event) => {
                    try {
                        const msg: ChatMessage = JSON.parse(event.data)
                        setMessages(prev => [...prev, msg])
                    } catch {
                        // Ignore parse errors for malformed messages
                    }
                }

                socket.onclose = () => {
                    // Connection closed
                }

                socket.onerror = () => {
                    setError("Connection error")
                }

                setWs(socket)
            } catch {
                // Connection failed
            }
        }

        connect()

        return () => {
            if (socket) socket.close()
        }
    }, [isOpen, user?.nickname])


    const handleSetNickname = async () => {
        if (!nicknameInput.trim()) return
        try {
            await authService.updateProfile(nicknameInput)
            await refreshUser()
        } catch {
            setError("Failed to set nickname")
        }
    }

    const handleSend = () => {
        if (!inputValue.trim() || !ws) return

        const msg = {
            content: inputValue,
            type: 'message'
        }

        ws.send(JSON.stringify(msg))
        setInputValue('')
    }

    if (!user) return null

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-20 xs:bottom-24 md:bottom-6 left-4 md:left-6 h-12 w-12 bg-card border border-border/50 text-foreground rounded-full shadow-lg hover:shadow-xl transition-all duration-300 z-chat flex items-center justify-center hover:scale-105 active:scale-95"
            >
                <MessageCircle size={20} />
            </button>
        )
    }

    return (
        <div
            className={`fixed bg-background/95 border border-border shadow-2xl rounded-lg z-chat transition-all duration-300 flex flex-col overflow-hidden backdrop-blur supports-[backdrop-filter]:bg-background/60 ${
                isMinimized
                    ? 'bottom-20 xs:bottom-24 md:bottom-6 left-4 md:left-6 w-64 md:w-80 h-12'
                    : 'bottom-20 xs:bottom-24 md:bottom-0 left-0 right-0 md:left-6 md:right-auto w-full md:w-[360px] h-[50vh] xs:h-[55vh] md:h-[500px] rounded-t-lg md:rounded-lg'
            }`}
        >
            { }
            <div
                className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/40 cursor-pointer"
                onClick={() => !user.nickname ? null : setIsMinimized(!isMinimized)}
            >
                <div className="flex items-center gap-2">
                    <span className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-600 dark:bg-red-500 animate-pulse" />
                        Live Chat
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized) }} className="text-muted-foreground hover:text-foreground transition-colors">
                        {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setIsOpen(false) }} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X size={14} />
                    </button>
                </div>
            </div>

            { }
            {!isMinimized && (
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    {!user.nickname ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-6 text-center animate-in fade-in duration-300">
                            <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mb-2">
                                <UserIcon size={32} className="text-muted-foreground" />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg mb-1">Join the conversation</h3>
                                <p className="text-xs text-muted-foreground">Enter a nickname to chat.</p>
                            </div>
                            <div className="w-full space-y-2">
                                <input
                                    value={nicknameInput}
                                    onChange={e => setNicknameInput(e.target.value)}
                                    className="w-full px-3 py-2 rounded-md border border-input bg-card text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                    placeholder="Nickname"
                                />
                                <button
                                    onClick={handleSetNickname}
                                    disabled={!nicknameInput.trim()}
                                    className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
                                >
                                    Join
                                </button>
                            </div>
                            {error && <p className="text-red-500 text-xs">{error}</p>}
                        </div>
                    ) : (
                        <>
                            { }
                            <div className="flex-1 overflow-y-auto p-2 space-y-0.5 scrollbar-thin scrollbar-thumb-muted/50 scrollbar-track-transparent">
                                {messages.map((msg, i) => {
                                    const isMe = msg.sender_id === user.id;
                                    const isSystem = msg.type === 'system';
                                    const userColor = getUserColor(msg.sender);

                                    if (isSystem) {
                                        return (
                                            <div key={i} className="py-1 px-2 text-xs italic text-muted-foreground/70">
                                                {msg.content}
                                            </div>
                                        )
                                    }

                                    return (
                                        <div key={i} className={`group py-0.5 px-2 rounded transition-colors text-[13px] leading-5 break-words ${isMe ? 'bg-primary/10 hover:bg-primary/20' : 'hover:bg-muted/50'
                                            }`}>
                                            <span className="text-[10px] text-muted-foreground/40 mr-1.5 align-middle select-none">
                                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            <span className={`font-bold mr-1.5 cursor-pointer hover:underline ${userColor}`}>
                                                {msg.sender}
                                                <span className="text-muted-foreground font-normal">:</span>
                                            </span>
                                            <span className={`text-foreground/90 ${isMe ? 'font-medium' : ''}`}>
                                                {msg.content}
                                            </span>
                                        </div>
                                    )
                                })}
                                <div ref={messagesEndRef} />
                            </div>

                            { }
                            <div className="p-3 bg-background border-t border-border/30">
                                <div className="relative">
                                    <input
                                        value={inputValue}
                                        onChange={e => setInputValue(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleSend()}
                                        placeholder="Send a message"
                                        className="w-full bg-muted/30 border-none rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40 pr-8"
                                        maxLength={200}
                                    />
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                        <button
                                            onClick={handleSend}
                                            disabled={!inputValue.trim()}
                                            className={`p-1.5 rounded-sm bg-transparent text-primary hover:bg-primary/10 transition-all ${!inputValue.trim() ? 'hidden' : 'block'}`}
                                        >
                                            <Send size={14} />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center mt-1 px-1">
                                    <div className="text-[10px] text-muted-foreground/40">
                                        {inputValue.length}/200
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
