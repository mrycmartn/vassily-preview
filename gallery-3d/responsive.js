// Keep the original photo wall and lightbox on phones; load WebGL on desktop only.
const phone = matchMedia('(max-width: 760px), (hover: none) and (max-width: 1024px)');
let loading;
function loadDesktopGallery() {
  if (!phone.matches && !loading) {
    loading = import('./scene.js').catch(error => {
      loading = null;
      console.warn('Using the original photo wall.', error);
    });
  }
}
phone.addEventListener('change', loadDesktopGallery);
loadDesktopGallery();
