const btnFilter = document.getElementById('btnFilter')
const filtros = document.getElementById('filtros')
const btnCloseFilter = document.getElementById('closeFilter')
const allFiltros = document.getElementById('filtroDesaparecer')

btnFilter.addEventListener('click', function () {
    console.log('Abriste o botão de Filtros')
    filtros.style.display='block'
    allFiltros.style.display='block';
})

btnCloseFilter.addEventListener('click', function() {
    console.log('Fechaste o Menu de Filtros')
    filtros.style.display='none'
})