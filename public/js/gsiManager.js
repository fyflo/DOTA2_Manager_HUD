class GSIManager {
    constructor() {
        this.socket = io('http://127.0.0.1:2626', {
            withCredentials: true,
            transports: ['websocket', 'polling']
        });
        
        this.gameState = {
            map: {},
            phase_countdowns: {},
            player: {},
            previously: {},
            provider: {},
            hero: {},
            abilities: {},
            items: {},
            draft: {},
            wearables: {},
            league: {},
            couriers: {},
            neutralitems: {},
            roshan: {},
            events: {},
            minimap: {},
            buyback: {},

        };

        this.callbacks = [];
        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Подключено к серверу');
            this.notifyCallbacks({ type: 'connect' });
        });

        this.socket.on('disconnect', () => {
            console.log('Отключено от сервера');
            this.notifyCallbacks({ type: 'disconnect' });
        });

        this.socket.on('gsi', (data) => {
            this.gameState = data;
            this.notifyCallbacks({ type: 'update', data: this.gameState });
        });

        // Отправляем сигнал готовности
        this.socket.emit('ready');
    }

    subscribe(callback) {
        this.callbacks.push(callback);
        return () => {
            this.callbacks = this.callbacks.filter(cb => cb !== callback);
        };
    }

    notifyCallbacks(event) {
        this.callbacks.forEach(callback => callback(event));
    }

    getGameState() {
        return this.gameState;
    }
}

// Создаем единственный экземпляр
window.gsiManager = window.gsiManager || new GSIManager();