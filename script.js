const btnOpen = document.getElementById('openMenu')
const btnClose = document.getElementById('closeMenu')
const menu = document.getElementById('menu')
const letras = document.getElementById('letters')
const btnVerMais = document.getElementById('mais')
const itensOculto = document.querySelectorAll('oculto')
const btnRemove = document.getElementById('remove')
const promocao = document.getElementById('proposal')

btnOpen.addEventListener('click', function() {
    menu.style.display='flex';
    letras.style.display='none';
    btnClose.style.display='block'
    console.log('Menu activado, Letras Especiais removidas e Botão de Remover o botão Activado')
})

btnClose.addEventListener('click', function() {
    menu.removeAttribute('style');
    btnClose.removeAttribute('style');
    letras.removeAttribute('style')
    console.log('Menu removido, Letras Voltaram ao normal')
})

btnVerMais.addEventListener('click', function() {
    itensOculto[1].style.display='flex';
    itensOculto[0].style.display='flex';
    console.log('Botão Ver Mais Pressionado')
})

btnRemove.addEventListener('click', function(){
    promocao.style.display='none'
    console.log('Anúncio Removido')
})