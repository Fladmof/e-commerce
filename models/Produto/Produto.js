const db = require('../db')
const Produto = db.sequelize.define('produtos', {
    nome: {
        type: db.Sequelize.STRING
    },
    foto: {
        type: db.Sequelize.BLOB
    },
    preco: {
        type: db.Sequelize.DECIMAL(10, 2)
    },
    descricao: {
        type: db.Sequelize.TEXT
    }
})

module.exports = Produto