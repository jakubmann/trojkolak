const io = require('./io.js')
const {v4:uuidv4} = require('uuid')

const shuffleArray = arr => arr
    .map(a => [Math.random(), a])
    .sort((a, b) => a[0] - b[0])
    .map(a => a[1]);

class Game {
    //id = Math.random().toString(36).substring(2, 13);
    id = 'test'
    wordCount = 5
    time = 60
    leader = ''
    timer = null
    state = {
        players: [],
        teams: [],
        words: [],
        activeWords: [],
        currentPlayer: 0,
        currentTeam: 0,
        currentWord: 0,
        round: 1,
        time: 0,
        view: 'lobby'
    }


    joinTeam(teamId, playerId) {
        let {players} = this.state
        let team = this.state.teams.find(t => t.id === teamId)
        let player = players.find(p => p.id === playerId)

        //Add player to team if he isn't there already
        if (!team.players.includes(player)) {
            team.players.push(player)
        }

        //Remove player from any other teams
        this.state.teams.map(t => {
            if (t.players.includes(player) && t.id !== teamId) {
                t.players = t.players.filter(p => p !== player)
            }
        })

        //Remove empty teams
        this.state.teams = this.state.teams.filter(t => t.players.length > 0)
        io.to(this.id).emit('teams', this.state.teams)
    }

    addPlayer(playerId, userId, username) {
 
        this.state.players.push({
            id: playerId,
            uid: userId,
            username: username
        })
        
        this.makeTeam(playerId)
        

        io.to(playerId)
            .emit('view', this.state.view)
            .emit('gameId', this.id)

    }

    makeTeam(playerId) {
        let teamId = uuidv4()
        this.addTeam(teamId)
        this.joinTeam(teamId, playerId)
    }

    addTeam(id) {
        this.state.teams.push({
            id: id,
            players: [],
            points: 0
        })

        io.to(this.id).emit('teams', this.state.teams)
    }

    start() {
        if (this.validateTeams()) {
            console.log('game started')
            this.state.view = 'words'
            io.to(this.id)
                .emit('view', this.state.view)
                .emit('players', this.state.players.length) 
        }
    }

    validateTeams() {
        let {teams} = this.state

        if (teams.length === 1) {
            io.to(this.id).emit('err', 'oneteam')
            return false
        }

        let valid = true
        teams.map(t => {
            if (t.players.length < 2) {
                io.to(this.id).emit('err', 'oneplayer')
                valid = false
            }
        })
        return valid
    }

    addWord(text, playerId) {
        let {words, players} = this.state
        
        //Limit player from adding more than five words
        if (words.filter(w => w.author === playerId).length <= 5) {
            this.state.words.push({
                text: text,
                author: playerId
            })

            io.to(this.id).emit('words', words.length)
        }
        if (words.filter(w => w.author === playerId).length === 5) {
            io.to(playerId).emit('maxWords')
        }

        if (words.length === players.length * this.wordCount) {
            this.startRound()
        }
    }

    startRound() {
        let {words} = this.state

        this.state.activeWords = shuffleArray(words)
        this.state.currentWord = this.state.activeWords[0]

        this.state.view = 'round'

        let time = this.state.time > 0 ? this.state.time : this.time
        io.to(this.id)
            .emit('view', this.state.view)
            .emit('round', this.state.round)
            .emit('time', time)        
        this.emitPlaying()
    }

    emitPlaying() {
        let {teams, currentTeam, currentPlayer} = this.state

        let explainPlayer = teams[currentTeam].players[currentPlayer].id
        console.log(teams[currentTeam].players[currentPlayer].username + ' is playing')
        io.to(explainPlayer).emit('playing', this.state.currentWord.text)

        teams[currentTeam].players.map(p => {
            if (p.id !== explainPlayer) {
                io.to(p.id).emit('guessing')
                console.log(p.username + ' is guessing')
            }
        })

    }

    nextPlayer() {
        io.to(this.id)
            .emit('nextRound')
        let {teams, currentTeam, currentPlayer} = this.state

        if (currentTeam === teams.length-1) {
            if (currentPlayer === teams[currentTeam].players.length - 1) {
                this.state.currentPlayer = 0
            } else {
                this.state.currentPlayer++
            }
            this.state.currentTeam = 0
        } else {
            this.state.currentTeam++
        }
        this.emitPlaying()
    }

    subRound() {
        if (this.state.time > 0) {
            this.state.time--
            
        } else {
            this.state.time = this.time
            io.to(this.id).emit('time', this.state.time)
        }
        this.timer = setInterval(() => {
            this.state.time -= 1
            io.to(this.id).emit('time', this.state.time)

            if (this.state.time < 1) {
                io.to(this.id).emit('time', this.state.time)
                clearInterval(this.timer)
                io.to(this.id).emit(this.time)
                this.nextPlayer()
            }
        }, 1000)
    }

    guessedWord() {
        this.state.teams[this.state.currentTeam].points += 1
        io.to(this.id).emit('teams', this.state.teams)
        io.to(this.id).emit('guessed')
        if (this.state.activeWords.length > 1) {
            this.state.currentWord = this.state.activeWords.pop()
            this.emitPlaying()
        } else {
            clearInterval(this.timer)
            this.nextRound()
        }
    }

    nextRound() {
        io.to(this.id)
            .emit('nextRound')

        this.state.round +=1
        if (this.state.round <= 3) {
            this.startRound()
        } else {
            this.endGame()
        }
    }

    endGame = () => {
        let {teams} = this.state
        console.log('GAME END')

        let leaderboard = teams.sort((a, b) => b.points - a.points)

        io.to(this.id).emit('view', 'leaderboard')
        io.to(this.id).emit('leaderboard', leaderboard)
    }

    removePlayer(playerId) {
        //TODO remove player from game if not leader
    }

    handleReconnect(playerId, socketId) {
        this.state.players.find(p => p.uid === playerId).id = socketId

        io.to(socketId)
        .emit('gameId', this.id)
        .emit('view', this.state.view)
        .emit('teams', this.state.teams)
        .emit('username', this.state.players.find(p => p.uid === playerId).username)
        if (this.leader === playerId) {
            io.to(socketId).emit('leader')
        }
        if (this.state.view === 'lobby') {

        }
        if (this.state.view === 'words') {
            io.to(socketId)
            .emit('words', this.state.words)

            if (words.filter(w => w.author === socketId).length === 5) {
                io.to(socketId).emit('maxWords')
            }
        }
        if (this.state.view === 'round') {
            io.to(socketId).emit('round', this.state.round)
            this.emitPlaying()
        }
    }

    playAgain = () => {
        var {players} = this.state
        console.log(this.state)
        this.state = {
            players: [],
            teams: [],
            words: [],
            activeWords: [],
            currentPlayer: 0,
            currentTeam: 0,
            currentWord: 0,
            round: 1,
            time: 0,
            view: 'lobby'
        }
        console.log(this.state)

        players.forEach(p => this.addPlayer(p.id, p.uid, p.username))

        console.log(this.state)

        
    }
    
}

module.exports = Game