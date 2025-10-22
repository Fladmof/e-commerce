const btnOpen = document.getElementById('openMenu')
const btnClose = document.getElementById('closeMenu')
const menu = document.getElementById('menu')
const letras = document.getElementById('letters')
const btnVerMais = document.getElementById('mais')
const itensOculto = document.getElementById('oculto')
const btnRemove = document.getElementById('remove')
const promocao = document.getElementById('set-off')
const btnPrev = document.getElementById('btnRecuar')
const btnNext = document.getElementById('btnAvancar')
const scrollContent = document.getElementById('comentariosGeral')
const imagem = document.getElementById('ucp')

btnOpen.addEventListener('click', function() {
    menu.style.display='flex';
    letras.style.display='none';
    btnClose.style.display='block'
    imagem.style.display='none'
    console.log('Menu activado, Letras Especiais removidas e Botão de Remover o botão Activado')
})

btnClose.addEventListener('click', function() {
    menu.removeAttribute('style');
    btnClose.style.display='nome';
    letras.removeAttribute('style')
    imagem.style.display='flex'
    console.log('Menu removido, Letras Voltaram ao normal')
})

btnRemove.addEventListener('click', function(){
    promocao.style.display='none'
    console.log('Anúncio Removido')
})

btnNext.addEventListener('click', function() {
    scrollContent.scrollBy({
        left: scrollContent.clientWidth, behavior: 'smooth'
    });
})

btnPrev.addEventListener('click', function() {
    scrollContent.scrollBy({
        left: -scrollContent.clientWidth, behavior: 'smooth'
    });
})