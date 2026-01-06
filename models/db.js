const Sequelize = require('sequelize')
const sequelize = new Sequelize(
    'ecommerce',
    'root', 
    '123456', 
    {
        host: "localhost",
        dialect: "mysql"
    }
)
sequelize.authenticate().then(()=>{
    console.log("Conexão com a base de dados feita com sucesso")
}).catch((err)=>{
    console.log(`Erro ao se conectar: ${err}`)
})

module.exports = {
    Sequelize: Sequelize,
    sequelize: sequelize
}