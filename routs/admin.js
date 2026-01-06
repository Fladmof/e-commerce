const express = require('express')
const router = express.Router()
const Produto = require('../models/Produto/Produto')
const storage = require("../multerconfig")
const multer = require('multer')

//Configurando o multer
const upload = multer({ storage: storage})
router.post("/upload", upload.single("file"), async (req, res)=> {
    
})
//Configurando as rotas
router.get("/", async(req, res)=>{
    const data = await Produto.findAll({ raw: true })
    res.render("homeA", {data})
    console.log(data)
})
router.use("/files", express.static("uploads"))

router.get('/produtos', (req, res)=>{
    res.send('Página de todos os produtos')
})
router.get('/cadastrar', (req, res)=>{
    res.render('cadastroP')
})
router.post('/produto/add', (req, res)=>{    
    
    var erros = []
    /*Fazendo a validação do Formulário*/
    if(!req.body.nome_produto || typeof req.body.nome_produto == undefined || req.body.nome_produto == null) {
        erros.push({texto: "Nome do Produto inválido"})
    } if(!req.body.preco_produto || typeof req.body.preco_produto == undefined || req.body.preco_produto == null) {
        erros.push({texto: "Preço do produto inválido"})
    } if(!req.body.img_produto || typeof req.body.img_produto == undefined || req.body.img_produto == null) {
        erros.push({texto: "Imagem do produto inválida"})
    } if(!req.body.desc_produto || typeof req.body.desc_produto == undefined || req.body.desc_produto == null) {
        erros.push({texto: "Descrição do Produto inválida"})
    } if(req.body.desc_produto.length < 10){
        erros.push({texto: "Descrição do produto demasiado curta"})
    } if(erros.length > 0){
        res.render("cadastroP", {erros: erros})
    } else{
        Produto.create({
            nome: req.body.nome_produto,
            preco: req.body.preco_produto,
            foto: req.body.img_produto,
            descricao: req.body.desc_produto
        }).then(()=>{
            req.flash("sucess_msg", "Categoria Criada com sucesso")
            res.redirect("/admin")
        }).catch((err)=>{
            req.flash("error_msg", "Erro ao cadastrar o produto")
            res.send("Falha ao cadastrar" + err)
        })
    }
})
router.get("/produto/deletar/:id", (req, res)=>{
    Produto.destroy({where: {"id": req.body.id}})
    res.render("home")
})

module.exports = router
