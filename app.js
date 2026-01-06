const express = require('express')
const app = express()
const hand = require('express-handlebars')
const bodyParser = require('body-parser')
const admin = require('./routs/admin')
const path = require('path')
const Produto = require('./models/Produto/Produto')
const session = require("express-session")
const flash = require("connect-flash")


//Configurando a Sessão
    app.use(session({
        secret: "Fl@dmof10",
        resave: true,
        saveUninitialized: true
    }))
//Configurando o Flash
    app.use(flash()) 
//Configurando o Middleware
    app.use((req, res, next)=>{
        res.locals.sucess_msg = req.flash("sucess_msg")
        res.locals.error_msg = req.flash("error_msg")
        next()
    })
//Configurando o bodyParser
    app.use(bodyParser.urlencoded({ extended:false}))
    app.use(bodyParser.json())
//Configurando o handlebars
    app.engine('handlebars', hand.engine({defaultLayout:'main'}))
    app.set('view engine', 'handlebars')
//path public
    app.use(express.static(path.join(__dirname,"public")))
//Definindo a rota
    app.get('/', (req, res)=>{
        res.render('home')
    })
//Rota do Administrador
    app.use('/admin', admin)
    app.get("/", async(req, res)=>{
        const data = await Produto.findAll({ raw: true })
        res.render("home", {data})
        console.log(data)
        res.render("home")
    })
//Configuração da conexão
    const Porta = 8090
    app.listen(Porta, ()=>{
        console.log(`Servidor conectado no endereço: http://localhost:${Porta}`)
    })